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
    config            = require('../config.js'),
    getToken          = require('../utilities/token.js'),
    sources           = require('../utilities/sources.js'),
    getRegionsInScope = require('../utilities/regions.js'),
    pkg               = require('../package.json'),
    setup             = require('../deployment/setup.js'),
    base              = pkg.folders.jsSource,
    deploy            = pkg.folders.build + pkg.name + '/',
    deploymentList    = [],
    new_config        = '',
    execfile          = require('child_process').execFile;

console.log('> Building: ' + deploy);

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
    if (err) {
        return onErr(err);
    }
});

/*
 * Execute glob based distribution of source files
 */
for ( var section in source ) {
    switch (section) {
        default:
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
            break;
    }
}

/*
 * Let's fix this to actually use the users credentials to promprt the proper selections using CI.
 * Let's also use aws-sdk to automatically publish the resulting checks to the right region
 */

/*
 * Update the config.js file with proper information if anything is empty
 */
function onErr(err) {
    if (err !== null) {
        console.error("Error: " + err);
        return 1;
    }
}

var updated    = false,
    properties = [],
    callback   = function() {},
    required   = {
        "api_url": ""
    };

for ( var requirement in required ) {
    var value = config[requirement];
    if (config[requirement] === "") {
        properties.push({"name": requirement});
        updated = true;
    }
}

// Prompt the user for data or fail
if (properties.length > 0) {
    console.log("Some required properties have not been set, please provide them below and we will update your config.js file for you.");
    prompt.start();
    prompt.get(properties, function (err, result) {
        if (err) { return onErr(err); }
        for ( var key in result ) {
            config[key] = result[key];
        };
    });
}

var ciLogin = [
        {"name": "identifier"},
        {"name": "secret"}
    ];

console.log("Please sign in to Cloud Insight so that we can integrate with your environments.");
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
                    console.log("Logging you in to the Cloud Insight API.");
                    if ( status === "SUCCESS" ) {
                        config.accountId = JSON.parse(new Buffer(token.split(".")[1], 'base64')).account;
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
                    console.log("Getting your environment list.");
                    if ( status === "SUCCESS" ) {
                        callback(null, token, environments.sources);
                    } else {
                        callback("Unable to fetch environments.");
                    }
                });
            },
            /*
             * Process source records
             */
            function(token, rows, callback) {
                var done = rows.length,
                    count = 0;
                console.log("Processing applicable environments and scope for application in AWS Lambda regions.");
                for (var row in rows) {
                    count = count + 1;
                    source = rows[row].source;
                    sources.getCredential(token, source.config.aws.credential.id, function(status, credential) {
                        if ( status === "SUCCESS" ) {
                            config.environmentId = source.id;
                            new_config           = 'var config = ' + JSON.stringify(config) + ';\nmodule.exports = config;';
                            var zipped           = '../ci_lambda_checks-' + config.accountId + '-' + source.name + '-' + source.id + '-' + pkg.version + '.zip';
                            fs.writeFile(deploy + 'config.js', new_config, function(err) {
                                process.chdir('target');
                                process.chdir('ci_lambda_checks');
                                execfile('zip', ['-r', '-X', zipped, './'], function(err, stdout) {});
                                process.chdir('../../');
                                if(err) {
                                    return callback("Unable to write deployment files.");
                                }
                            });
                            var deployment = {
                                "account": {
                                    "awsAccountId": credential.credential.iam_role.arn.split(":")[4],
                                    "id": config.accountId
                                },
                                "environment": {
                                    "name": source.name,
                                    "id": source.id,
                                    "file": "ci_lambda_checks-" + config.accountId + "-" + source.name + "-" + source.id + "-" + pkg.version + ".zip",
                                    "regions": []
                                }
                            };
                            getRegionsInScope(token, source.id, function(status, regions) {
                                if ( status === "SUCCESS" ) {
                                    for (var region in regions.assets) {
                                        var target = regions.assets[region][0].key.split('/')[2];
                                        if ( config.supported.indexOf(target) > -1 ) {
                                            deployment.environment.regions.push(target);
                                        }
                                    }
                                    if (deployment.environment.regions.length > 0) {
                                        deploymentList.push(deployment);
                                    }
                                    if (count === done) {
                                        callback(null);
                                    }
                                } else {
                                    callback("Unable to process environment regions.");
                                }
                            });
                        } else {
                            callback("Unable to process credentials.");
                        }
                    });
                }
            }
        ],
        function (err) {
            var index = 0,
                done  = deploymentList.length;
            for (env in deploymentList) {
                index = index + 1;
                prompt.start();
                console.log("Please provide the name of the AWS profile for environment: '" + deploymentList[env].environment.name + "'.")
                prompt.get('profile', function (err, profile) {
                    if (err) { return onErr(err); }
                    deploymentList[env].account.profile = profile.profile;
                    if (index === done) {
                        console.log("Beginning deployment process to AWS Lambda.");
                        setup(deploymentList);
                    }
                });
            }
        }
    );
});
