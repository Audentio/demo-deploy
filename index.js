#! /usr/bin/env node

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


// Load environment variables from .env.deploy file if it exists, else from .env file
const envFile = '.env.deploy';
const envVars = dotenv.config({ path: envFile }).parsed;
rootFolder = Path.join(process.cwd(), './');
deployItFolder = Path.join(rootFolder, '.deploy-it-files');
let entryPointFolder;

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



    // create a folder called .deploy-it-files
    if (!fs.existsSync('.deploy-it-files')) {
        fs.mkdirSync('.deploy-it-files');
    }

    const packageJson = require(Path.join(process.cwd(), './package.json'));

    if (!name) {
        name = envVars['NAME_DEPLOY'] || packageJson.name;
    }

    if (!host) {
        host = envVars['HOST_DEPLOY'] || `${name}.audent.ai`;
    }

    if (!projectType) {
        projectType = fs.existsSync(Path.join(process.cwd(), './next.config.js')) ? 'nextjs' : '';
    }

    if (!projectType) {
        packageJson.dependencies && packageJson['@nestjs/core'] ? 'nestjs' : '';
    }


    if (!projectType) {
        // check for php files
        if (fs.existsSync(Path.join(rootFolder, './index.php'))) {
            entryPointFolder = './';
            projectType = 'php';
        }
        if (fs.existsSync(Path.join(rootFolder, './artisan'))) {
            entryPointFolder = './';
            projectType = 'php';
        }

        if (fs.existsSync(Path.join(rootFolder, './composer.json'))) {
            entryPointFolder = './';
            projectType = 'php';
        }
        if (!projectType) {
            if (fs.existsSync(Path.join(rootFolder, './public/index.php'))) {
                projectType = 'php';
                entryPointFolder = './public';
            }
        }

        if (!projectType) {
            if (fs.existsSync(Path.join(rootFolder, './src/index.php'))) {
                projectType = 'php';
                entryPointFolder = './src';
            }
        }


        if (projectType === 'php') {
            createPHPDeployFiles();
        }
    }

    if (!projectType) {
        projectType = 'nodejs';
    }



    if (!port) {
        port = envVars['PORT_DEPLOY'] || process.env.PORT || 0;

        if (!port) {
            if (projectType === 'nextjs') {
                // in package.json look for "start": "next start -p 9093" and get the port only
                const packageJson = require(Path.join(process.cwd(), './package.json'));
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

            if (projectType === 'php') {
                port = 8080;
            }
        }
    }


    // check inputs
    if (!name || !host || !port || !projectType) {
        if (!name) console.error('Please set the name in the deployit.js file');
        if (!host) console.error('Please set the host in the deployit.js file');
        if (!port) console.error('Please set the port in the deployit.js file');
        if (!projectType) console.log('Could not detect project type, Please set the projectType in the deployit.js file')
        process.exit(1);
    }



    const infoBlock = {
        "Public Address": `https://${host}`,
        "Server Name": name,
        "Internal Port": port,
        "External Port": 443,
        // protocol: 'https',
        "Persistent Storage Location": '/data',
        "Project Type": projectType,
    }
    console.log('\n');
    console.table(infoBlock)
    console.log('\nDeploying \x1b[32m%s\x1b[0m to host \x1b[32m%s\x1b[0m  (internal server port \x1b[32m%s\x1b[0m) - %s project type\n', name, host, port, projectType);

    console.log('(NOTE: edit the .env.deploy file to change these values)\n')


    createDockerFile();


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



        const dockerBuild = spawn('docker', ['build', '--platform', 'linux/amd64', '-t', name, '-f', Path.join(deployItFolder, 'Dockerfile'), '.']);

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
                                const pvcYaml = createPvcYaml(name);

                                fetch('http://k8s1.audent.ai:8129/deploy', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${process.env.API_KEY_DEPLOY}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ yaml: deployYaml, pvcYaml: pvcYaml })
                                })
                                    .then(response => response.text())
                                    .then(body => {
                                        if (body.indexOf('Deployment successful') > -1) {

                                            console.log('\nDeployment successful!');
                                            // console.log('\nDeployled \x1b[32m%s\x1b[0m to host \x1b[32m%s\x1b[0m  (internal server port \x1b[32m%s\x1b[0m) - %s project type\n', name, host, port, projectType);
                                            console.log('Public Address: \x1b[32m%s\x1b[0m', `https://${host}\n`);
                                        } else {
                                            console.error(`An error occurred during deployment: ${body}`);
                                        }


                                    })
                                    .catch(error => console.error(`An error occurred: ${error}`));
                            }
                        });
                    }
                });
            }
        });

        function createPvcYaml(nameOfYourServer) {
            const pvcYaml = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${nameOfYourServer}-data-volume-claim
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi`;
            return pvcYaml;
        }


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
        imagePullPolicy: Always
        ports:
        - containerPort: ${portYourServerRunsOn}
          name: http
          protocol: TCP
        volumeMounts:
        - name: data-volume
          mountPath: /data
      volumes:
      - name: data-volume
        persistentVolumeClaim:
          claimName:  ${nameOfYourServer}-data-volume-claim

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

function createDockerFile() {
    // Dockerfile for nodejs regular project
    let dockerfileNodeJS = `# Dockerfile
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

# Set environment variables here

EXPOSE ${port}

CMD ["npm", "run", "start"]
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

    // Dockerfile for php project
    const PHP_VERSION = '8.0.30-r0';
    let dockerfilePHP = `FROM php:8.2.18-fpm-alpine

# https://github.com/wp-cli/wp-cli/issues/3840
ENV PAGER="more"

RUN apk update && apk upgrade
RUN apk add bash

RUN apk add --no-cache nginx supervisor curl tzdata htop mysql-client dcron
RUN apk --no-cache add  php82 php82-sqlite3 php82-ctype php82-curl php82-dom php82-exif php82-fileinfo php82-fpm php82-gd php82-iconv php82-intl php82-mbstring php82-mysqli php82-opcache php82-openssl php82-pecl-imagick php82-pecl-redis php82-phar php82-session php82-simplexml php82-soap php82-xml php82-xmlreader php82-zip php82-zlib php82-pdo php82-xmlwriter php82-tokenizer php82-pdo_mysql
RUN apk add --update php-pdo_sqlite

RUN apk add nodejs npm

RUN node --version
RUN npm --version

# Install PHP tools
RUN curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp
RUN php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" && php composer-setup.php --install-dir=/usr/local/bin --filename=composer

# Configure nginx
COPY .deploy-it-files/server/etc/nginx/nginx.conf /etc/nginx/nginx.conf

# Configure PHP-FPM
COPY .deploy-it-files/server/etc/php/php-fpm.d/www.conf /etc/php8/php-fpm.d/www.conf
COPY .deploy-it-files/server/etc/php/php-fpm.conf /etc/php8/php-fpm.conf
COPY .deploy-it-files/server/etc/php/php.ini /etc/php8/conf.d/custom.ini

# Configure supervisord
COPY .deploy-it-files/server/etc/supervisord.conf /etc/supervisor/conf.d/supervisord.conf


# Setup document root
RUN mkdir -p /var/www/html

# Make sure files/folders needed by the processes are accessable when they run under the nobody user
RUN chown -R nobody.nobody /var/www/html && \
  chown -R nobody.nobody /run && \
  chown -R nobody.nobody /var/lib/nginx && \
  chown -R nobody.nobody /var/log/nginx

RUN chown -R nobody.nobody /var/log/php82

# Add application
WORKDIR /var/www/html
COPY --chown=nobody ${entryPointFolder} /var/www/html/

# Run Composer install
RUN composer install
RUN php artisan migrate

# Run npm install and build
RUN npm install
RUN npm run build

# Switch to use a non-root user from here on
USER nobody

# ADDITIONAL RUN COMMANDS HERE

# Expose the port nginx is reachable on
EXPOSE 8080

# add a persistent volume for app use
VOLUME [ "/data" ]

# Let supervisord start nginx & php-fpm
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

# Configure a healthcheck to validate that everything is up&running
HEALTHCHECK --timeout=10s CMD curl --silent --fail http://127.0.0.1:8080/fpm-ping
`



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
    if (!gitignorefile.includes('.env.deploy')) {
        console.log('appending .env.deploy to .gitignore');
        fs.appendFileSync('.gitignore', '.env.deploy\n');
    }



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
        case 'php':

            dockerFile = dockerfilePHP;
            break;
    }


    // if package.json does not have a build command, comment out the build command in the Dockerfile "RUN npm run build"

    const packageJson = require(Path.join(rootFolder, 'package.json'));
    if (!packageJson.scripts.build) {
        dockerFile = dockerFile.replace('RUN npm run build', '# RUN npm run build');
    }

    // if there is no composer.json file, comment out the composer install command in the Dockerfile "RUN composer install"

    if (!fs.existsSync(Path.join(rootFolder, 'composer.json'))) {
        dockerFile = dockerFile.replace('RUN composer install', '# RUN composer install');
    }

    // if package.json does not have a start command, change "CMD ["npm", "run", "start"]" command in the Dockerfile "CMD ["node", "."]"

    if (!packageJson.scripts.start) {
        dockerFile = dockerFile.replace('CMD ["npm", "run", "start"]', 'CMD ["node", "."]');
    }

    // Insert each environment variable at the specified location in the Dockerfile
    const envVarsString = Object.entries(envVars)
        .map(([key, value]) => `ENV ${key}=${value}`)
        .join('\n');
    dockerFile = dockerFile.replace('# Set environment variables here', envVarsString);



    if (!fs.existsSync(Path.join(deployItFolder, 'Dockerfile'))) {
        fs.writeFileSync(Path.join(deployItFolder, 'Dockerfile'), dockerFile);
    } else {
        console.log('Dockerfile already exists, delete it if you want to recreate it');
    }

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


function createPHPDeployFiles() {
    // create nginx.conf file
    console.log('Creating PHP deploy files... \n')

    // recursivly create the folder deployItFolder/server/etc/nginx/conf.d
    // and recursivly create the folder deployItFolder/server/etc/php/php-fpm.d

    if (!fs.existsSync(Path.join(deployItFolder, 'server'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server'));
    }

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server/etc'));
    }

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/nginx'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server/etc/nginx'));
    }

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/nginx/conf.d'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server/etc/nginx/conf.d'));
    }

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/php'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server/etc/php'));
    }

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.d'))) {
        fs.mkdirSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.d'));
    }

    const nginxConf = String.raw`
worker_processes 1;
error_log stderr warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;

    # Define custom log format to include reponse times
    log_format main_timed '$remote_addr - $remote_user [$time_local] "$request" '
                            '$status $body_bytes_sent "$http_referer" '
                            '"$http_user_agent" "$http_x_forwarded_for" '
                            '$request_time $upstream_response_time $pipe $upstream_cache_status';

    access_log /dev/stdout main_timed;
    error_log /dev/stderr notice;

    keepalive_timeout 65;

    # Max body size
    client_max_body_size 192M;

    # Write temporary files to /tmp so they can be created as a non-privileged user
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp_path;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;

    # Default server definition
    server {
        listen [::]:8080 default_server;
        listen 8080 default_server;
        server_name _;

        # When redirecting from /url to /url/, use non-absolute redirects to avoid issues with 
        # protocol and ports (eg. when running the Docker service on 8080 but serving in production on 443)
        # https://stackoverflow.com/a/49638652
        absolute_redirect off;

        sendfile off;

        index index.html index.htm index.php;

        charset utf-8;

        root /var/www/html/public;

        location / {
            try_files $uri $uri/ /index.php?$query_string;
        }

        # Redirect server error pages to the static page /50x.html
        error_page 500 502 503 504 /50x.html;
        location = /50x.html {
            root /var/lib/nginx/html;
        }

        location = /favicon.ico { access_log off; log_not_found off; }
        location = /robots.txt  { access_log off; log_not_found off; }
    
        error_page 404 /index.php;

        # Pass the PHP scripts to PHP-FPM listening on 127.0.0.1:9000
        location ~ \.php$ {
            try_files $uri =404;

            fastcgi_buffers 16 16k; 
            fastcgi_buffer_size 32k;

            fastcgi_split_path_info ^(.+\.php)(/.+)$;
            fastcgi_pass 127.0.0.1:9000;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            fastcgi_param SCRIPT_NAME $fastcgi_script_name;
            fastcgi_index index.php;
            include fastcgi_params;
        }

        location ~* \.(jpg|jpeg|gif|png)$ {
            expires 180d;
        }

        location ~* \.(css|js|ico)$ {
            expires 1d;
        }

        # Deny access to . files, for security
        location ~ /\.(?!well-known).* {
            deny all;
        }

        # Allow fpm ping and status from localhost
        location ~ ^/(fpm-status|fpm-ping)$ {
            access_log off;
            allow 127.0.0.1;
            deny all;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            include fastcgi_params;
            fastcgi_pass 127.0.0.1:9000;
        }
    }
    
    gzip on;
    gzip_proxied any;
    gzip_types 
        text/plain
        text/css
        text/js
        text/xml
        text/javascript
        application/javascript
        application/x-javascript
        application/json
        application/xml
        application/xml+rss
        application/rss+xml
        image/svg+xml/javascript;
    gzip_vary on;
    gzip_disable "msie6";
    
    # Include other server configs
    include /etc/nginx/conf.d/*.conf;
}
`;

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/nginx/nginx.conf'))) {
        console.log('creating nginx.conf file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/nginx/nginx.conf'), nginxConf);
    } else {
        console.log('nginx.conf file already exists, delete it if you want to recreate it');
    }


    const nginxDefaultConf = String.raw`server {
    index index.php index.html index.htm;
    listen 80;
    listen [::]:80;
    location / {
        try_files $uri $uri/ =404;
    }
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8-fpm.sock;
        include fastcgi.conf;
    }
    root /usr/share/nginx/html;
    server_name localhost;
}
`;

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/nginx/conf.d/default.conf'))) {
        console.log('creating default.conf file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/nginx/conf.d/default.conf'), nginxDefaultConf);
    } else {
        console.log('default.conf file already exists, delete it if you want to recreate it');
    }



    const phpFPMConf = String.raw`[global]
; Log to stderr
error_log = /dev/stderr

[www]
; The address on which to accept FastCGI requests.
; Valid syntaxes are:
;   'ip.add.re.ss:port'    - to listen on a TCP socket to a specific IPv4 address on
;                            a specific port;
;   '[ip:6:addr:ess]:port' - to listen on a TCP socket to a specific IPv6 address on
;                            a specific port;
;   'port'                 - to listen on a TCP socket to all addresses
;                            (IPv6 and IPv4-mapped) on a specific port;
;   '/path/to/unix/socket' - to listen on a unix socket.
; Note: This value is mandatory.
listen = 127.0.0.1:9000

; Enable status page
pm.status_path = /fpm-status

; Ondemand process manager
pm = ondemand

; The number of child processes to be created when pm is set to 'static' and the
; maximum number of child processes when pm is set to 'dynamic' or 'ondemand'.
; This value sets the limit on the number of simultaneous requests that will be
; served. Equivalent to the ApacheMaxClients directive with mpm_prefork.
; Equivalent to the PHP_FCGI_CHILDREN environment variable in the original PHP
; CGI. The below defaults are based on a server without much resources. Don't
; forget to tweak pm.* to fit your needs.
; Note: Used when pm is set to 'static', 'dynamic' or 'ondemand'
; Note: This value is mandatory.
pm.max_children = 100

; The number of seconds after which an idle process will be killed.
; Note: Used only when pm is set to 'ondemand'
; Default Value: 10s
pm.process_idle_timeout = 10s;

; The number of requests each child process should execute before respawning.
; This can be useful to work around memory leaks in 3rd party libraries. For
; endless request processing specify '0'. Equivalent to PHP_FCGI_MAX_REQUESTS.
; Default Value: 0
pm.max_requests = 1000

; Make sure the FPM workers can reach the environment variables for configuration
clear_env = no

; Catch output from PHP
catch_workers_output = yes

; Remove the 'child 10 said into stderr' prefix in the log and only show the actual message
decorate_workers_output = no

; Enable ping page to use in healthcheck
ping.path = /fpm-ping
`

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.conf'))) {
        console.log('creating php-fpm.config file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.conf'), phpFPMConf);
    } else {
        console.log('php-fpm.conf file already exists, delete it if you want to recreate it');
    }


    const phpINI = String.raw`
[PHP]
file_uploads = On
upload_max_filesize = 256M
post_max_size = 256M

[Date]
date.timezone="UTC"

[opcache]
opcache.enable=1
opcache.memory_consumption=128
opcache.max_accelerated_files=30000
opcache.revalidate_freq=0
opcache.revalidate_path=1
#opcache.file_update_protection=30
#opcache.consistency_checks=1

# Logging
# opcache.log_verbosity_level=4

# https://github.com/docker-library/php/issues/772
# https://stackoverflow.com/a/21291587
#opcache.optimization_level=0x00000000
opcache.optimization_level=0xFFFFFBFF

# JIT - due to crashes on WordPress Upgrades, we can't use the tracing jit mode
opcache.jit_buffer_size=64M
opcache.jit=1255

#opcache.jit=disable
#opcache.jit_debug=1048576
`;

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/php/php.ini'))) {
        console.log('creating php.ini file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/php/php.ini'), phpINI);
    } else {
        console.log('php.ini file already exists, delete it if you want to recreate it');
    }


    const wwwConf = String.raw`[global]
; Log to stderr
error_log = /dev/stderr

[www]
; The address on which to accept FastCGI requests.
; Valid syntaxes are:
;   'ip.add.re.ss:port'    - to listen on a TCP socket to a specific IPv4 address on
;                            a specific port;
;   '[ip:6:addr:ess]:port' - to listen on a TCP socket to a specific IPv6 address on
;                            a specific port;
;   'port'                 - to listen on a TCP socket to all addresses
;                            (IPv6 and IPv4-mapped) on a specific port;
;   '/path/to/unix/socket' - to listen on a unix socket.
; Note: This value is mandatory.
listen = 127.0.0.1:9000

; Enable status page
pm.status_path = /fpm-status

; Ondemand process manager
pm = ondemand

; The number of child processes to be created when pm is set to 'static' and the
; maximum number of child processes when pm is set to 'dynamic' or 'ondemand'.
; This value sets the limit on the number of simultaneous requests that will be
; served. Equivalent to the ApacheMaxClients directive with mpm_prefork.
; Equivalent to the PHP_FCGI_CHILDREN environment variable in the original PHP
; CGI. The below defaults are based on a server without much resources. Don't
; forget to tweak pm.* to fit your needs.
; Note: Used when pm is set to 'static', 'dynamic' or 'ondemand'
; Note: This value is mandatory.
pm.max_children = 100

; The number of seconds after which an idle process will be killed.
; Note: Used only when pm is set to 'ondemand'
; Default Value: 10s
pm.process_idle_timeout = 10s;

; The number of requests each child process should execute before respawning.
; This can be useful to work around memory leaks in 3rd party libraries. For
; endless request processing specify '0'. Equivalent to PHP_FCGI_MAX_REQUESTS.
; Default Value: 0
pm.max_requests = 1000

; Make sure the FPM workers can reach the environment variables for configuration
clear_env = no

; Catch output from PHP
catch_workers_output = yes

; Remove the 'child 10 said into stderr' prefix in the log and only show the actual message
decorate_workers_output = no

; Enable ping page to use in healthcheck
ping.path = /fpm-ping
`;

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.d/www.conf'))) {
        console.log('creating www.conf file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/php/php-fpm.d/www.conf'), wwwConf);
    } else {
        console.log('www.conf file already exists, delete it if you want to recreate it');
    }



    const supervisordconf = String.raw`[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
pidfile=/run/supervisord.pid

[program:php-fpm]
command=php-fpm82 -F
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=false
startretries=0

[program:nginx]
command=nginx -g 'daemon off;'
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=false
startretries=0
`

    if (!fs.existsSync(Path.join(deployItFolder, 'server/etc/supervisord.conf'))) {
        console.log('creating supervisord.conf file');
        fs.writeFileSync(Path.join(deployItFolder, 'server/etc/supervisord.conf'), supervisordconf);
    } else {
        console.log('supervisord.conf file already exists, delete it if you want to recreate it');
    }



}



main();


