const dotenv = require('dotenv');
const fs = require('fs');
const Path = require('path');
const { exec, spawn } = require('child_process');


// CONFIGURATION, EDIT THESE VALUES
let name = '';   // of this app/docker image/and server on rancher (default is the name in package.json)
let host = '';   // (myapp.example.com) host to attach to this container (default is the name + example.com)
let port = 0;  // port the server will be running on inside the container (same as if you run npm run start locally)
let projectType = ''; // (default calculated) 'nextjs', 'nestjs', or 'nodejs' depending on the type of project you are deploying, default is detected based on the presence of a next.config.js or @nestjs/core dependency
// END CONFIGURATION

async function main() {

    // check if package.json exists
    if (!fs.existsSync('./package.json')) {
        console.error('Please run this script from the root of your project.  (package.json not found)');
        process.exit(1);
    }

    // check if  .env.deploy exists
    if (!fs.existsSync('.env.deploy')) {
        console.error('Please create a .env.deploy file with the necessary environment variables');
        process.exit(1);
    }

    // Load environment variables from .env.deploy file if it exists, else from .env file
    const envFile = '.env.deploy';
    const envVars = dotenv.config({ path: envFile }).parsed;

    if (!name) {
        name = envVars['NAME_DEPLOY'] || require('./package.json').name;
    }

    if (!host) {
        host = envVars['HOST_DEPLOY'] || `${name}.audent.ai`;
    }

    if (!projectType) {
        projectType = fs.existsSync('./next.config.js') ? 'nextjs' : require('./package.json').dependencies['@nestjs/core'] ? 'nestjs' : 'nodejs';
    }

    if (!port) {
        port = envVars['PORT_DEPLOY'] || process.env.PORT || 0;

        if (!port) {
            if (projectType === 'nextjs') {
                // in package.json look for "start": "next start -p 9093" and get the port only
                const packageJson = require('./package.json');
                const nextStartScript = packageJson.scripts.start;
                const match = nextStartScript.match(/-p (\d+)/);
                if (match) {
                    port = parseInt(match[1]);
                } else {
                    port = 3000;
                }
            }
            if (projectType === 'nestjs') {
                port = 3050;
            }
            if (projectType === 'nodejs') {
                port = 3000;
            }
        }
    }


    // check inputs
    if (!name || !host || !port || !projectType) {
        console.error('Please set the name, host, port, and projectType in the deployit.js file');
        process.exit(1);
    }



    const infoBlock = {
        publicAddress: `https://${host}`,
        serverName: name,
        internalPort: port,
        externalPort: 443,
        protocol: 'https',
        projectType,
    }
    console.log('\n');
    console.table(infoBlock)
    console.log('\nDeploying \x1b[32m%s\x1b[0m to host \x1b[32m%s\x1b[0m  (internal server port \x1b[32m%s\x1b[0m) - %s project type\n', name, host, port, projectType);

    console.log('(NOTE: edit the deployit.js file to change these values)\n')

    // ask user to confirm with y/n before proceeding
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question('Do you want to proceed? (y/n) \n', answer => {
        if (answer.toLowerCase() !== 'y') {
            console.log('Exiting...');
            process.exit();
        }





        // Dockerfile for nodejs regular project
        let dockerfileNodeJS = `# Dockerfile
FROM node:20-alpine

# Install Git
RUN apk add --no-cache git

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

# Set environment variables here

EXPOSE ${port}

CMD ["npm", "run", "start]
`;

        // Dockerfile for nestjs
        let dockerfileNestJS = `# Dockerfile
FROM node:20-alpine

# Install Git
RUN apk add --no-cache git

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN chmod +x ./start.sh

RUN npm run build

RUN npx patch-package --patch-dir ./node_modules/ailib/patches

# Set environment variables here

EXPOSE ${port}

CMD ["./start.sh"]
`;


        // Dockerfile for nextjs project
        let dockerfileNextJS = `# Dockerfile
FROM node:20-alpine AS builder

# Install Git
RUN apk add --no-cache git

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

# Stage 2: Run
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy from build stage
COPY --from=builder /usr/src/app/package.json .
COPY --from=builder /usr/src/app/package-lock.json .
COPY --from=builder /usr/src/app/next.config.js ./
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/.next/standalone ./
COPY --from=builder /usr/src/app/.next/static ./.next/static



# Install production dependencies only
#RUN npm ci --only=production
# END STAGE 2

# Set environment variables here

EXPOSE ${port}

#CMD ["npm", "run", "start"]
CMD ["node", "server.js"]
`;

        // create a folder called .deploy-it-files
        // if (!fs.existsSync('.deploy-it-files')) {
        //   fs.mkdirSync('.deploy-it-files');
        // }

        // make sure the Dockerfile createdb.js and start.sh are in the .gitignore file
        if (!fs.existsSync('./.gitignore')) {
            fs.writeFileSync('./.gitignore', '');
        }

        let gitignorefile = fs.readFileSync('.gitignore', 'utf8');
        if (!gitignorefile.includes('Dockerfile')) {
            console.log('appending Dockerfile to .gitignore');
            fs.appendFileSync('.gitignore', 'Dockerfile\n');
        }
        if (!gitignorefile.includes('createdb.js')) {
            console.log('appending createdb.js to .gitignore');
            fs.appendFileSync('.gitignore', 'createdb.js\n');
        }
        if (!gitignorefile.includes('start.sh')) {
            console.log('appending start.sh to .gitignore');
            fs.appendFileSync('.gitignore', 'start.sh\n');
        }

        const rootFolder = './';


        // Write the updated Dockerfile
        let dockerFile;
        switch (projectType) {
            case 'nextjs':
                dockerFile = dockerfileNextJS;
                break;
            case 'nestjs':
                createStartSh();
                // createDatabaseJs();
                dockerFile = dockerfileNestJS;
                break;
            case 'nodejs':
                dockerFile = dockerfileNodeJS;
                break;
        }

        // Insert each environment variable at the specified location in the Dockerfile
        const envVarsString = Object.entries(envVars)
            .map(([key, value]) => `ENV ${key}=${value}`)
            .join('\n');
        dockerFile = dockerFile.replace('# Set environment variables here', envVarsString);


        fs.writeFileSync(Path.join(rootFolder, 'Dockerfile'), dockerFile);

        const dockerBuild = spawn('docker', ['build', '-t', name, '-f', Path.join(rootFolder, 'Dockerfile'), '.']);

        dockerBuild.stdout.on('data', (data) => {
            console.log(`${data}`);
        });

        dockerBuild.stderr.on('data', (data) => {
            console.error(`${data}`);
        });

        dockerBuild.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            if (code === 0) {
                const dockerTag = spawn('docker', ['tag', name, `registry.rapidohio.com/${name}`]);

                dockerTag.on('close', (code) => {
                    console.log(`child process exited with code ${code}`);
                    if (code === 0) {
                        const dockerPush = spawn('docker', ['push', `registry.rapidohio.com/${name}`]);

                        dockerPush.stdout.on('data', (data) => {
                            console.log(`${data}`);
                        });

                        dockerPush.stderr.on('data', (data) => {
                            console.error(`${data}`);
                        });

                        dockerPush.on('close', (code) => {
                            console.log(`child process exited with code ${code}`);
                            if (code === 0) {
                                const deployYaml = createDeployYaml(name, host, port);

                                fetch('http://k8s1.audent.ai:8129/deploy', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${process.env.API_KEY_DEPLOY}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ yaml: deployYaml })
                                })
                                    .then(response => response.text())
                                    .then(body => console.log(body))
                                    .catch(error => console.error(`An error occurred: ${error}`));
                            }
                        });
                    }
                });
            }
        });


        function createDeployYaml(nameOfYourServer, hostName, portYourServerRunsOn) {
            const deployYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${nameOfYourServer}-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${nameOfYourServer}
  template:
    metadata:
      labels:
        app: ${nameOfYourServer}
    spec:
      containers:
      - name: ${nameOfYourServer}
        image: registry.rapidohio.com/${nameOfYourServer}
        ports:
        - containerPort: ${portYourServerRunsOn}
          name: http
          protocol: TCP

---
apiVersion: v1
kind: Service
metadata:
  name: ${nameOfYourServer}-prod
spec:
  ipFamilyPolicy: SingleStack
  selector:
    app: ${nameOfYourServer}
  ports:
    - name: ${nameOfYourServer}
      protocol: TCP
      port: ${portYourServerRunsOn}
      targetPort: ${portYourServerRunsOn}
  type: ClusterIP

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${nameOfYourServer}-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - ${hostName}
    secretName: wildcard-audent-ai-1
  rules:
  - host: ${hostName}
    http:
      paths:
      - pathType: Prefix
        path: "/"
        backend:
          service:
            name: ${nameOfYourServer}-prod
            port:
              number: ${portYourServerRunsOn}
`;

            return deployYaml;
        }


        readline.close();
    }); // end readline.question

}

function createStartSh() {
    console.log('creating start.sh file (used for starting server within the container)');
    const file = `#!/bin/sh
#node createdb.js
npm run migration:run
npm run start:prod`

    fs.writeFileSync(Path.join(rootFolder, 'start.sh'), file);
}

function createDatabaseJs() {
    console.log('creating database.js file');

    const file = `require('dotenv').config();
    const mysql = require('mysql2/promise');
    
    async function createDatabase() {
      const { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE } = process.env;
    
      // Create a connection to the MySQL server (without specifying a database)
      const connection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USERNAME,
        password: DB_PASSWORD,
      });
    
      // Query the server to see if the database exists
      const [rows] = await connection.execute('SHOW DATABASES LIKE ' + connection.escape(DB_DATABASE));
    
      // If the database doesn't exist, create it
      if (rows.length === 0) {
        await connection.execute(\`CREATE DATABASE $\{DB_DATABASE\}\`);
        console.log(\`Database $\{DB_DATABASE\} created.\`);
      } else {
        console.log(\`Database $\{DB_DATABASE\} already exists.\`);
      }
    
      await connection.end();
    }
    
    createDatabase().catch(console.error);`

    fs.writeFileSync(Path.join(rootFolder, 'createdb.js'), file);


}


main();


