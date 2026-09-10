# Redeploying the cloud PSAT

Creating a GitHub release does not update the server. When code is merged, someone has to pull it
onto the EC2 instance and rebuild the containers, using the steps below.

You connect with AWS Systems Manager Session Manager. There is no SSH key and no
open SSH port; the instance is reachable only through SSM and, for web traffic,
through CloudFront.

## Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed.
- [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  installed. This is a separate download from the AWS CLI, and `aws ssm start-session`
  fails without it.
- The same access key ID and secret access key used for uploading surveys. The one
  account covers both. If you have already set up the `psat-upload` profile, skip
  step 1.

## 1. Create your AWS CLI profile (one time, skip if you already did it)

```powershell
aws configure --profile psat-upload
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
aws ssm describe-instance-information --filters "Key=InstanceIds,Values=i-0a661a01291465e39" --profile psat-upload
```

`PingStatus` should be `Online`. If it is not, the instance is stopped or its SSM
agent is down, and connecting will not work.

## 3. Connect

```powershell
aws ssm start-session --target i-0a661a01291465e39 --profile psat-upload
```

You land as `ssm-user`, which has passwordless `sudo`.

## 4. Redeploy

```bash
cd /opt/psat-repo
sudo git pull
sudo docker compose up -d --build
```

If `sudo git pull` fails, run this once and retry:

```bash
sudo git config --system --add safe.directory /opt/psat-repo
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

**`--build` discards anything written inside the containers.** Only the paths
mounted from the host survive: `data/`, `in/`, `profiles/` and
`Generated Reports/` from `docker-compose.yml`, plus whatever the server-local
`docker-compose.override.yml` adds. Survey folders in `in/` are safe.

**GIS layers come from a server-only override file.** `backend/shapefiles/` is
excluded from the image by `.dockerignore` (only the git-tracked
`gradient_profiles/` subtree is baked in). The 5 GB of layers are synced from S3
onto the host and bind-mounted into the container by a `docker-compose.override.yml`
that exists only on the server, not in git. If the app shows no GIS layers after a
rebuild, check that the override is present and mounts onto `/app/shapefiles`:

```bash
cd /opt/psat-repo
sudo cat docker-compose.override.yml
sudo ls backend/shapefiles | head
sudo docker compose exec backend ls /app/shapefiles
```

The first should show a `backend` service with a volume ending in `:/app/shapefiles`.
The second and third should list the same folders. If the override is missing, the
container only has `gradient_profiles/` and the app will look empty.

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