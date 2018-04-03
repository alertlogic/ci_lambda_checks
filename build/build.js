/*
 * Build dependencies and configuration
 */
var fs                = require('fs'),
    glob              = require('glob-all'),
    mkdirp            = require('mkdirp'),
    path              = require('path'),
    uglifyjs          = require('uglify-js'),
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

/*
 * Create the node_modules directory so that it exists for installation regardless of module definitions for deployment
 */
mkdirp(deploy + 'node_modules/', function (err) {
    fs.createReadStream('./package.json').pipe(fs.createWriteStream('./target/ci_lambda_checks/package.json'));
    execfile('npm', ['install', '--only=production', '--prefix', 'target/ci_lambda_checks'], function(err, stdout) {
        /*
         * Execute glob based distribution of source files
         */
        for ( var section in source ) {
            glob.sync(source[section]).forEach(function(item) {
                mkdirp(path.dirname(item.replace(base, deploy)), function (err) {
                    if (err) {
                        return onErr(err);
                    } else {
                        switch (this.section) {
                            case 'application':
                                var minified = uglifyjs.minify(item, {mangle: false});
                                fs.writeFile(item.replace(base, deploy), minified.code.replace('release.version', pkg.version));
                                break;
                            default:
                                fs.createReadStream(item).pipe(fs.createWriteStream(item.replace(base, deploy)));
                                break;
                        }
                    }
                }.bind({section: section}));
            });
        }
    });
    if (err) {
        return onErr(err);
    }
});

/*
 * Let's fix this to actually use the users credentials to promprt the proper selections using CI.
 * Let's also use aws-sdk to automatically publish the resulting checks to the right region
 */

/*
 * Update the config.js file with proper information if anything is empty
 */
function onErr(err) {
    if (err !== null) {
        winston.error(err);
        return 1;
    }
}

var ciLogin = [
        {"name": "identifier"},
        {"name": "secret", "required": true, "hidden": true}
    ];

winston.info("Please sign in to Cloud Insight so that we can integrate with your environments.");
prompt.start();
prompt.get(ciLogin, function (err, result) {
    if (err) { return onErr(err); }
    for ( var key in result ) {
        config[key] = result[key];
    };

    async.waterfall(
        [
            /*
             * Fetch token or fail
             */
            function(onErr) {
                getToken(function(status, token) {
                    winston.info("Logging you in to the Cloud Insight API.");
                    if ( status === "SUCCESS" ) {
                        config.accountId = JSON.parse(new Buffer(token.split(".")[1], 'base64')).account;
			winston.info("Token: " + token);
                        onErr(null, token);
                    } else {
                        onErr(status);
                    }
                });
            },
            /*
             * Get list of available environments
             */
            function(token, callback) {
                sources.getSources(token, function(status, environments) {
                    winston.info("Getting your environment list.");
                    if ( status === "SUCCESS" ) {
                        callback(null, token, environments.sources);
                    } else {
                        callback("Unable to fetch environments. Status " + status);
                    }
                });
            },
            /*
             * Process source records
             */
            function(token, rows, callback) {
                var count = 0,
                    awsAccounts = {};
                async.eachSeries(rows, function(row, sourcesAsyncCallback) {
                    var source = row.source;
                    if (!source.config.hasOwnProperty('aws') ||
                        !source.config.aws.hasOwnProperty('credential') ||
                        !source.config.aws.credential.hasOwnProperty('id')) {
                        return sourcesAsyncCallback();
                    }
                    sources.getCredential(token, source.config.aws.credential.id, function(status, credential) {
                        if (!credential.credential.hasOwnProperty('iam_role')) {
                            return sourcesAsyncCallback();
                        }

                        var environmentId   = source.id,
                            awsAccountId    = credential.credential.iam_role.arn.split(":")[4],
                            awsRegions         = [];
                        // Get regions in scope for the environment
                        if (!awsAccounts.hasOwnProperty(awsAccountId)) {
                            awsAccounts[awsAccountId] = {"regions": []};
                        } else {
                            awsRegions = awsAccounts[awsAccountId].regions;
                        }
                        assets.getRegionsInScope(token, source.id, function(status, regions) {
                            if (status !== "SUCCESS") {return sourcesAsyncCallback(status);}
                            for (var region in regions.assets) {
                                var target = regions.assets[region][0].name;
                                if (awsRegions.indexOf(target) < 0) {
                                    awsRegions.push(target);
                                }
                            }
                            awsAccounts[awsAccountId].regions = awsRegions;
                            return sourcesAsyncCallback();
                        });
                    });
                },
                function(err) {
                    if (err) {
                        winston.error("Failed to discover protected regions. Error: " + JSON.stringify(err));
                        return callback(err);
                    } else {
                        winston.info("Successfully discovered protected regions.");
                        return callback(null, awsAccounts);
                    }
                });
            },
            function(awsAccounts, callback) {
                promptForProfileNew(awsAccounts, callback);
            },
            function(awsAccounts, callback) {
                var fileName = 'ci_lambda_checks-' + config.accountId + '-' + pkg.version + '.zip';
                var zipped  = '../' + fileName;
                fs.writeFileSync(deploy + 'config.js', 'var config = ' + JSON.stringify(config) + ';\nmodule.exports = config;');
                process.chdir('target/ci_lambda_checks');

		var proc = spawn('zip', ['-r', '-X', zipped, './']);
		proc.on("exit", function(exitCode) {
                    process.chdir('../../');
                    var deploymentSpec = {
                        "accountId": config.accountId,
                        "file": fileName,
                        "awsAccounts": awsAccounts
                    };
                    setup(deploymentSpec, callback);
		});

		proc.stdout.on("data", function(chunk) {
		    return;
		});

		proc.stdout.on("end", function() {
		    return;
		});

            }
        ],
        function (err) {
            if (err) {
                winston.error("Build failed. Error: " + JSON.stringify(err));
            }
            callback(err);
        }
    );
});

function promptForProfileNew(awsAccounts, callback) {
    "use strict";
    var schema = {
        "properties": {}
    };
    Object.getOwnPropertyNames(awsAccounts).forEach(function(awsAccountId, idx, array) {
        schema.properties[awsAccountId] = {
            "required": true,
            "message": "Please provide the name of the AWS profile for AWS Account: '" + awsAccountId + "'"
        };
    });

    prompt.start();
    prompt.get(schema, function (err, result) {
        if (err) { return onErr(err); }
        Object.getOwnPropertyNames(awsAccounts).forEach(function(awsAccountId, idx, array) {
            awsAccounts[awsAccountId]["profile"] = result[awsAccountId];
        });
        return callback(null, awsAccounts);
    });
}
