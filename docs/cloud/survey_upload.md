# Uploading a survey to the cloud PSAT

Survey folders are not copied onto the server by hand. You upload the folder to the
S3 bucket `path-psat-dev-uploads`, and a timer on the EC2 instance syncs the bucket
into the app's `in/` directory every 2 minutes. The bucket root **is** the `in/`
directory, so `s3://path-psat-dev-uploads/<FOLDER>/` becomes `in/<FOLDER>/` on the
server and shows up in the app's source-folder list under that name.

## Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed.
- The `khinkhin-profile` AWS profile configured on your machine (SSO login to the PSAT account).
- The survey folder on your disk, named the way you want it to appear in the app,
  e.g. `PUNGGOL EAST_1Q2026`. Images can sit directly in the folder or in
  sub-folders (for example `Cam4/`); the app scans recursively for
  `.jpg .jpeg .png .tif .tiff .bmp .webp`.

## Steps

1. Check that you can reach the bucket:

   ```powershell
   aws s3 ls s3://path-psat-dev-uploads/ --profile khinkhin-profile
   ```

   If that errors (for example `Error when retrieving token from sso` or
   `ExpiredToken`), log in again and retry:

   ```powershell
   aws sso login --profile khinkhin-profile
   ```

2. Upload the folder. The folder name becomes the survey name, so keep the
   trailing slash on the S3 side and quote names that contain spaces:

   ```powershell
   aws s3 cp "C:\path\to\PUNGGOL EAST_1Q2026" s3://path-psat-dev-uploads/"PUNGGOL EAST_1Q2026"/ --recursive --profile khinkhin-profile
   ```

   The CLI prints one line per file. A folder of a few thousand photos takes a
   few minutes on an office connection.

3. Wait up to 2 minutes, then refresh the app at
   <https://d13nyc943hd6xx.cloudfront.net>. The survey appears in the
   source-folder list when you create a new project.

## Notes

- **Adding photos later:** re-run the same `aws s3 cp` command. Only new files
  are transferred by the sync, and existing ones are left alone.
- **Nothing is deleted automatically.** The server sync runs without `--delete`,
  so removing objects from the bucket does not remove them from the app. Ask an
  admin to delete a survey folder on the instance if it must go.
- **Upload-only credentials:** if you were given the `path-psat-dev-uploader`
  access key instead of SSO, configure it as its own profile
  (`aws configure --profile psat-uploader`) and use that profile name in the
  commands above. That user can list the bucket and add files, but cannot read
  or delete anything.
- **Verify what landed:**

  ```powershell
  aws s3 ls "s3://path-psat-dev-uploads/PUNGGOL EAST_1Q2026/" --recursive --profile khinkhin-profile | Measure-Object -Line
  ```
