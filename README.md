# Deploy Apps to Audentio's Cloud


### create an .env.deploy file in the root of your project with the following content:

```bash
##############################################
# deployment vars for the deployit.js script
# deploy an instance to kubernetes running with rancher at audent.ai
##############################################

# API KEY IS REQUIRED to deploy to the remote server
API_KEY_DEPLOY=

# OPTIONAL: these will be calculated if not provided
PORT_DEPLOY=3000
HOST_DEPLOY=myapp.audent.ai
NAME_DEPLOY=myapp

```

### run the deploy script

```bash
npx deployit
```


Done! Your app is now deployed to the cloud. You can access it at `https://myapp.audent.ai`

