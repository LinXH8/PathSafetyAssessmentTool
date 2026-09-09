# Redeploying the cloud PSAT

Nothing deploys automatically. There is no CI pipeline, and creating a GitHub
release does not update the server. When code is merged, someone has to pull it
onto the EC2 instance and rebuild the containers by hand, using the steps below.

You connect with AWS Systems Manager Session Manager. There is no SSH key and no
open SSH port; the instance is reachable only through SSM and, for web traffic,
through CloudFront.

| | |
| --- | --- |
| Instance ID | `i-0a661a01291465e39` |
| Region | `ap-southeast-1` |
| App directory | `/opt/psat-repo` |
| App URL | https://d13nyc943hd6xx.cloudfront.net |

## Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed.
- [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  installed. This is a separate download from the AWS CLI, and `aws ssm start-session`
  fails without it.
- The access key ID and secret access key for the deploy account, sent to you by
  the platform team.

## 1. Create your AWS CLI profile (one time)

```powershell
aws configure --profile psat-deploy
```

It will prompt for four values:

```
AWS Access Key ID     [None]: <paste the access key ID>
AWS Secret Access Key [None]: <paste the secret access key>
Default region name   [None]: ap-southeast-1
Default output format [None]: json
```

## 2. Check the instance is reachable

```powershell
aws ssm describe-instance-information --filters "Key=InstanceIds,Values=i-0a661a01291465e39" --profile psat-deploy
```

`PingStatus` should be `Online`. If it is not, the instance is stopped or its SSM
agent is down, and connecting will not work.

## 3. Connect

```powershell
aws ssm start-session --target i-0a661a01291465e39 --profile psat-deploy
```

You land as `ssm-user`, which has passwordless `sudo`.

## 4. Redeploy

```bash
cd /opt/psat-repo
sudo git pull
sudo docker compose up -d --build
```

The rebuild takes roughly 5 to 15 minutes: it reinstalls Python dependencies and
rebuilds the frontend. The app is briefly unavailable while the containers are
recreated at the end.

## 5. Check it came back up

```bash
sudo docker compose ps
sudo docker compose logs --tail 30 backend
```

Both services should show `Up`. Then from your own machine:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://d13nyc943hd6xx.cloudfront.net/api/health
```

`200` means the backend is serving. Finally open the app in a browser.

If something is wrong, `sudo docker compose logs backend` is the first place to look.

## Things to know before you rebuild

**`--build` discards anything written inside the containers.** Only four paths are
mounted from the host and survive: `data/`, `in/`, `profiles/` and
`Generated Reports/`. Notably `shapefiles/` is *not* mounted, so GIS layers uploaded
through the app are lost on rebuild. Survey folders in `in/` are safe.

**`git pull` will fail if files were edited directly on the server.** If someone has
hand-edited `docker-compose.yml` or anything else under `/opt/psat-repo`, the pull
stops with a conflict. Check first:

```bash
sudo git -C /opt/psat-repo status
```

**Check which branch the server is on.** It is not necessarily `main`:

```bash
sudo git -C /opt/psat-repo rev-parse --abbrev-ref HEAD
```

**Disk fills up over time.** Old images accumulate with every rebuild. If a build
fails for lack of space:

```bash
df -h /
sudo docker image prune -f
```

## What the deploy account can and cannot do

| Action | Allowed |
| --- | --- |
| Open an SSM session on this one instance | Yes |
| Full root on that instance, via `sudo` | Yes |
| Reach any other EC2 instance | No |
| Read or write S3, IAM, or anything else in the account | No |

The account is scoped against the rest of the AWS account, not against the
instance. Anyone holding these keys effectively has root on the server, so treat
them accordingly.
