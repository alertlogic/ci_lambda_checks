/*
 * Build dependencies and configuration
 */
var fs                = require('fs'),
    glob              = require('glob-all'),
    mkdirp            = require('mkdirp'),
    path              = require('path'),
    uglifyjs          = require('uglify-js'),
    _                 = require('lodash')
    prompt            = require('prompt'),
    async             = require('async'),
    AWS               = require('aws-sdk'),
    winston           = require('winston'),
    config            = require('../config.js'),
    getToken          = require('../utilities/token.js'),
    sources           = require('../utilities/sources.js'),
    assets            = require('../utilities/assets.js'),
    pkg               = require('../package.json'),
    setup             = require('../deployment/setup.js'),
    base              = pkg.folders.jsSource,
    deploy            = pkg.folders.build + pkg.name + '/',
    deploymentList    = [],
    accountList       = [],
    callback          = function() {},
    execfile          = require('child_process').execFile,
    spawn 	      = require('child_process').spawn;

const TEN_MEGA_BYTE = 1024 * 1024 * 10;

winston.info('Building Lambda checks to ' + deploy);

/*
 * Source location mappings for glob
 */
var source = {
    "application": [
        base + '**/*.js',
        '!' + base + 'build/**',
        '!' + base + 'git-hooks/**',
        '!' + base + 'node_modules/**',
        '!' + base + 'target/**',
        '!' + base + 'utility/**',
        '!' + base + 'deployment/**'
    ],
    "config": [
        base + 'package.json'
    ]
};


var awsRegions      = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1', 'ca-central-1', 'sa-east-1'];


/*
 * Create the node_modules directory so that it exists for installation regardless of module definitions for deployment
 */
var argv = require('yargs').argv;
if (argv._.indexOf("publish") > -1) {
    return buildAndPublish();
} else {
    return build();
} 

function buildAndPublish() {
    async.waterfall([
        npmInstall,
        makeDistribution,
        makeZip,
        publishPackage,
        updateCFTemplate
    ],
    function (err) {
        return onErr(err)
    });
}

function build() {
    async.waterfall([
        npmInstall,
        makeDistribution,
        makeZip
    ],
    function (err) {
        return onErr(err)
    });
}

function npmInstall(callback) {
    mkdirp(deploy + 'node_modules/', function (err) {
        if (err) {
            return callback(err);
        }

        fs.createReadStream('./package.json').pipe(fs.createWriteStream('./target/ci_lambda_checks/package.json'));
        execfile('npm', ['install', '--only=production', '--prefix', 'target/ci_lambda_checks'], function(err, stdout) {
            if (err) {
                console.log("npm install failed. Error: " + err);
                return callback(err);
            } else {
                return callback(null);
            }
        });
    });
}

/*
 * Execute glob based distribution of source files
 */
function makeDistribution(callback) {
    async.each(Object.getOwnPropertyNames(source), function(section, eachCallback) {
            async.each(glob.sync(source[section]), function(item, filesCallback) {
                mkdirp(path.dirname(item.replace(base, deploy)), function (err) {
                    if (err) {
                        console.log("mkdirp failed. Error: " + JSON.stringify(err));
                        return filesCallback(err);
                    } else {
                        var stream = fs.createReadStream(item).pipe(fs.createWriteStream(item.replace(base, deploy)));
                        stream.on('finish', function() {
                            filesCallback(null);
                        });
                    }
                }.bind({section: section}));
            },
            function(err) {
                return eachCallback(null);
            });
        },
        function(err) {
            console.log("Finished making distribution.");
            return callback(null);
        }
    );
}

function makeZip(callback) {
    var fileName = 'ci_lambda_checks-' + pkg.version + '.zip';
    var zipped  = '../' + fileName;
    fs.writeFileSync(deploy + 'config.js', 'var config = ' + JSON.stringify(config) + ';\nmodule.exports = config;');
    console.log("Compressing: %s, Dir: %s", zipped, process.cwd());
    execfile('zip', ['-r', '-X', zipped, './'], {maxBuffer: TEN_MEGA_BYTE, cwd: 'target/ci_lambda_checks'}, function(err, stdout) {
        if (err) {
            return callback(err);
        }
        return callback(null, fileName);
    });
}

function publishPackage(fileName, callback) {
    console.log("Publishing '%s' package to S3", fileName);
    // Prompt for profile to use to deploy our package to S3
    var profile = {
            required: true
        },
        bucketPrefix = {
            description: 'Provide backet name prefix to upload files. The region name will be appended to the name you provide.',
            required: true,
            default: 'alertlogic-public-repo'
        },
        promptSchema = {properties: {}};
        params = {
            s3KeyPrefix: "lambda_packages",
            fileDir: "../target/",
            fileName: fileName
        };

    if (typeof (argv.profile) !== "undefined") { params['profile'] = argv.profile; } 
    else { promptSchema.properties['profile'] = profile; }

    if (typeof (argv.bucketPrefix) !== "undefined") { params['bucketPrefix'] = argv.bucketPrefix; }
    else { promptSchema.properties['bucketPrefix'] = bucketPrefix; }

    if (Object.keys(promptSchema.properties).length) {
        prompt.start();
        prompt.get(promptSchema, function (err, input) {
            if (err) { return onErr(err); }
            return uploadFile(_.merge(params, input), callback);
        });
    } else {
        return uploadFile(params, callback);
    }
}

function updateCFTemplate(params, resultCallback) {
    "use strict";
    process.chdir(__dirname);

    var jsonTemplateFile = "../configuration/cloudformation/ci_lambda_checks.template";
    console.log("Updating '" + jsonTemplateFile + "'.");
    async.waterfall([
        function(callback) {
            fs.readFile(jsonTemplateFile, { encoding: 'utf8' }, function (err, data) {
                if (err) {return callback(err);}
                // parse and return json to callback
                var json = JSON.parse(data);
                return callback(null, json);
            });
        },
        function(template, callback) {
            var modified = false;
            if (template.Parameters.CloudInsightCustomChecksLambdaS3BucketNamePrefix.Default !== params.bucketPrefix) {
                template.Parameters.CloudInsightCustomChecksLambdaS3BucketNamePrefix.Default = params.bucketPrefix;
                modified = true;

            }
            if (template.Parameters.CloudInsightCustomChecksLambdaPackageName.Default !== params.fileName) {
                template.Parameters.CloudInsightCustomChecksLambdaPackageName.Default = params.fileName;
                modified = true;
            }
            return callback(null, modified ? template : null);
        },
        function (template, callback) {
            if (template) {
                return fs.writeFile(jsonTemplateFile, JSON.stringify(template, null, 4), callback);
            } else {
                return callback(null);
            }
        }
    ], function (err) {
        if (err) {
            return resultCallback(err);
        } else {
            params['fileDir']       = "../configuration/cloudformation/",
            params['fileName']      = "ci_lambda_checks.template";
            params['s3KeyPrefix']   = "templates";
            return uploadFile(params, resultCallback);
        }
    });
}

function uploadFile(params, callback) {
    var AWS             = new require('aws-sdk');
        credentials = new AWS.SharedIniFileCredentials({profile: params.profile});
        AWS.config.credentials = credentials,
        s3 = new AWS.S3({'signatureVersion': 'v4'}),
        fileName = params.fileName, 
        code = require('fs').readFileSync(
                                require('path').resolve(
                                    __dirname,
                                    params.fileDir + fileName));

    // async.eachSeries(awsRegions, function(region, seriesCallback) {
    async.each(awsRegions, function(region, seriesCallback) {
        var bucketName = params.bucketPrefix + "." + region;
        console.log("Uploading '" + fileName + "' to '" + bucketName + "' bucket.");
        s3.endpoint = getS3Endpoint(region);
        var s3Params = {
                "Bucket": bucketName,
                "Key": params.s3KeyPrefix + "/" + fileName,
                "Body": code,
                "ContentType": "application/binary"
            };
        s3.putObject(s3Params, function(err, _result) {
            if (err) {
                console.log("Failed to persist '" + fileName + "' object to '" + bucketName +
                            "' bucket. Error: " + JSON.stringify(err));
                return seriesCallback(err);
            } else {
                // console.log("Successfully persisted '" + fileName + "'.");
                return seriesCallback(null);
            }
        });
    },
    function(err) {
        if (err) {
            console.log("Upload to S3 failed. Error: " + JSON.stringify(err));
            return callback(err);
        } else {
            return callback(null, params);
        }
    });
}

function onErr(err) {
    if (err !== null) {
        winston.error(err);
        return 1;
    }
}

function getS3Endpoint(region) {
    "use strict";
    if (!region || region === 'us-east-1' || region === '') {
            return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}
