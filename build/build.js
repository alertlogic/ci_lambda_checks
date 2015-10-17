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
    console.error("Error: " + err);
    return 1;
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

    var token = getToken(function(status, token) {
        if ( status === "SUCCESS" ) {
            var environmentList = sources.getSources(token, function(status, environments) {
                if ( status === "SUCCESS" ) {
                    async.each(
                        environments.sources,
                        function(source, callback) {

                            var name  = source.source.name,
                                id    = source.source.id,
                                creds = sources.getCredential(token, source.source.config.aws.credential.id, function(status, credential) {
                                    if ( status === "SUCCESS" ) {

                                        var awsAccountId = credential.credential.iam_role.arn.split(":")[4];

                                        config.environmentId = id;

                                        new_config           = 'var config = ' + JSON.stringify(config) + ';\nmodule.exports = config;';
                                        var zipped           = '../ci_lambda_checks-' + config.accountId + '-' + name + '-' + config.environmentId + '-' + pkg.version + '.zip';

                                        fs.writeFile(deploy + 'config.js', new_config, function(err) {
                                            process.chdir('target');
                                            process.chdir('ci_lambda_checks');
                                            execfile('zip', ['-r', '-X', zipped, './'], function(err, stdout) {});
                                            // This will help us deploy to all regions the customer has in scope per environment
                                            deployList = [];
                                            process.chdir('../../');
                                            if(err) {
                                                return onErr(err);
                                            }
                                        });

                                        var regionList = getRegionsInScope(token, id, function(status, regions) {
                                            if ( status === "SUCCESS" ) {
                                                var deployTo = {
                                                    "account": {
                                                        "awsAccountId": awsAccountId,
                                                        "id": config.accountId
                                                    },
                                                    "environment": {
                                                        "name": name,
                                                        "id": id,
                                                        "file": 'ci_lambda_checks-' + config.accountId + '-' + name + '-' + id + '-' + pkg.version + '.zip',
                                                        "regions": []
                                                    }
                                                };
                                                async.each(
                                                    regions.assets,
                                                    function(region, callback) {
                                                        for (var row in region) {
                                                            var target = region[row].key.split('/')[2];
                                                            if ( config.supported.indexOf(target) > -1 ) {
                                                                deployTo.environment.regions.push(target);
                                                            }
                                                        }
                                                        callback();
                                                    },
                                                    function(err){
                                                        // Just ignore this, it's screwy assets empty rows.
                                                    }
                                                );
                                                // Now we can deploy, YAY!
                                                if (deployTo.environment.regions.length > 0) {
                                                    setup([deployTo]);
                                                }
                                            } else {
                                                return onErr(err);
                                            }
                                        });
                                    } else {
                                        return onErr(err);
                                    }
                                });
                        },
                        function(err){
                            return onErr(err);
                        }
                    );
                } else {
                    return onErr(err);
                }
            });
        } else {
            return onErr(err);
        }
    });
});
