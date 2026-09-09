# Uploading a survey to the cloud PSAT

You upload the folder to the S3 bucket `path-psat-dev-uploads`, and a timer on the
EC2 instance syncs the bucket into the app's `in/` directory every 2 minutes.

The bucket root **is** the `in/` directory, so `s3://path-psat-dev-uploads/<FOLDER>/`
becomes `in/<FOLDER>/` on the server and shows up in the app's source-folder list
under that name.

## Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed.
- The access key ID and secret access key for the upload account, sent to you by
  the platform team.
- The survey folder on your disk, named the way you want it to appear in the app,
  e.g. `PUNGGOL EAST_1Q2026`. Images can sit directly in the folder or in
  sub-folders (for example `Cam4/`); the app scans recursively for
  `.jpg .jpeg .png .tif .tiff .bmp .webp`.

Everything must live inside a folder. Loose images uploaded to the bucket root are
ignored, because the app lists only directories as source folders.

## Steps

### 1. Create your AWS CLI profile (one time)

```powershell
aws configure --profile psat-upload
```

It will prompt for four values. Paste in the key ID and secret you were sent:

```
AWS Access Key ID     [None]: <paste the access key ID>
AWS Secret Access Key [None]: <paste the secret access key>
Default region name   [None]: ap-southeast-1
Default output format [None]: json
```

### 2. Check your credentials work

```powershell
aws sts get-caller-identity --profile psat-upload
```

Expected — confirms you are using the upload account:

```json
{
    "Account": "172147427533",
    "Arn": "arn:aws:iam::172147427533:user/path-psat-dev-uploader"
}
```

### 3. Check you can reach the bucket

```powershell
aws s3 ls s3://path-psat-dev-uploads/ --profile psat-upload
```

You should see the survey folders already uploaded.

### 4. Upload the folder

The folder name becomes the survey name, so keep the trailing slash on the S3 side
and quote names that contain spaces:

```powershell
aws s3 sync "C:\path\to\PUNGGOL EAST_1Q2026" s3://path-psat-dev-uploads/"PUNGGOL EAST_1Q2026"/ --profile psat-upload
```

`sync` is used rather than `cp --recursive` because a survey can be thousands of
images: if the upload is interrupted, re-run the same command and it resumes,
transferring only what is missing.

Uploading to a folder name that already exists adds to it rather than replacing it.

### 5. Wait up to 2 minutes, then refresh the app

The survey appears in the source-folder list when you create a new project.

## Removing a folder

```powershell
aws s3 rm s3://path-psat-dev-uploads/"PUNGGOL EAST_1Q2026"/ --recursive --profile psat-upload
```

**This removes the folder from the upload bucket only. It does not remove the survey
from PSAT.** The sync adds folders but never deletes them, so the survey stays in the
app until the platform team removes it from the server. Ask them if you need it gone.

## What this account can and cannot do

| Action | Allowed |
| --- | --- |
| Upload survey folders | Yes |
| List folders in the bucket | Yes |
| Download from the bucket | Yes |
| Delete from the bucket | Yes |
| Permanently destroy data | No — deletes are recoverable |
| Anything outside this bucket | No |

To download a folder back from the bucket:

```powershell
aws s3 sync s3://path-psat-dev-uploads/"PUNGGOL EAST_1Q2026"/ "C:\path\to\download" --profile psat-upload
```

## Tips

To avoid typing `--profile psat-upload` on every command, set it once per terminal
session:

```powershell
$env:AWS_PROFILE = "psat-upload"
```

If a command fails with an authentication error, re-check step 2 first. If step 2
passes but step 3 fails, it is a permissions problem rather than a typo in your keys.
