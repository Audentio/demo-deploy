# Deploy Apps to Audentio's Cloud

## Install deployz

```bash
    npm install -g deployz
```




### Create an   **.env.deploy**   file in the root of your project:

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

### run the deploy command from your terminal

```shell
user:~$ deployit
```


Done! Your app is now deployed to `https://myapp.audent.ai`


# NOTES


- assumes a non-nextjs or non-nestjs nodejs app starts with ```npm run start```
-  will auto detect nextjs and nestjs aps and deploy them accordingly

-  will auto detect the port of the app if not provided in the env.deploy file, or default to 3000
-  will auto detect the host of the app if not provided in the .env.deploy file, or default to package.json name
- will auto detect the name of the app if not provided in the .env.deploy file, or default to package.json name

