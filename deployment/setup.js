/*
 * The setup performs the following actions:
 * Setup AWS Config recording for the specified region and return SNS Topic ARN configured for AWS Config.
 * If the AWS Config already setup properly, but doesn't have recording on or doesn publish updates to the SNS Topic,
 * ensure that recording is on and the Topic is setup.
 * In addition, setup lambda custom checks function to receive and process SNS notifications from AWS Config.
 */
var async           = require('async'),
    awsConfigSetup  = require('./awsconfig_setup.js'),
    roleSetup       = require('./role_setup.js'),
    s3Setup         = require('./s3_setup.js'),
    snsSetup        = require('./sns_setup.js'),
    lambdaSetup     = require('./lambda_setup.js'),
    awsRegions      = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-northeast-1'];
    // awsRegions      = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1'],

var defaultLambdaRoleName   = 'cloudinsight_custom_checks_lambda_role',
    defaultFunctionName     = 'ci_custom_checks',
    defaultHandlerName      = 'index.handler';

var deploy = function(environments, callback) {
    "use strict";
    async.filter(environments, isValidEnvironment, function(results) {
        async.each(environments, deployEnvironment,
        function(err) {
            console.log("Finished deploying custom checks.");
            callback(err);
        });
    });
};

function isValidEnvironment(config, callback) {
    "use strict";
    var account         = config.account,
        environment     = config.environment,
        AWS             = new require('aws-sdk');
    if (account.profile && account.profile.length > 0) {
        var credentials = new AWS.SharedIniFileCredentials({profile: account.profile});
        AWS.config.credentials = credentials;
    }

    var iam = new AWS.IAM({apiVersion: '2010-05-08'});
    iam.getUser({}, function(err, data) { 
        if (err) {
            console.log("Failed to lookup user specified by '" + account.profile + "' profile. " +
                             "Skipping deployment of  Error: " + JSON.stringify(err));
            callback(false);
        } else {
            var user = data.User;
            if (user.Arn.split(":")[4] === account.awsAccountId) {
                callback(true);
            } else {
                console.log("Skipping deploymeny for '" + environment.name + "' environment. Credentials specified in '" + account.profile + "' didn't match target account. " +
                            "Account referenced in profile credentials" + user.Arn.split(":")[4] + ". Account referenced in the environment: " + account.awsAccountId);
                callback(false);
            }
        }
    });
}

function deployEnvironment(config, resultCallback) {
    "use strict";
    var account         = config.account,
        environment     = config.environment,
        logger          = function(msg) {
            console.log("[Environment: " + environment.name + "] " + msg);
        };

    logger("Ensuring proper AWS Config setup and deploying CloudInsight custom checks lambda function" +
            " to the '" + environment.regions.toString() + "' regions.");

    awsRegions.reverse();
    async.forEachOf(environment.regions.filter(isSupportedRegion), function(regionName, _index, callback) {
        deployRegion(regionName, account, environment, logger, function(err) {
                return callback(err);
        });
    },
    function(err) {
        if (err) {
            logger("Errors occurred. Deployment aborted.");
        } else {
            logger("SUCCESS! " +
                   "AWS Config setup and CloudInsight custom checks lambda function deployment completed for '" +
                   environment.regions.toString() + " regions.");
        }
        resultCallback();
    });
}

function deployRegion(regionName, account, environment, logger, callback) {
    "use strict";
    var AWS             = new require('aws-sdk');
    if (account.profile && account.profile.length > 0) {
        var credentials = new AWS.SharedIniFileCredentials({profile: account.profile});
        AWS.config.credentials = credentials;
    }

    var setupData       = {
            aws:    AWS,
            region: regionName,
            setupRegion: regionName,
            accountId: account.awsAccountId,
            supportedRegions: awsRegions,
            lambda: {
                functionName:   defaultFunctionName + "_" + account.id + "_" + environment.id,
                roleName:       defaultLambdaRoleName,
                handler:        defaultHandlerName,
                runtime:        'nodejs',
                timeout:        300,
                zipFile: require('fs').readFileSync(
                            require('path').resolve(
                                __dirname,
                                '../target/' + environment.file))
            },
            logger: function(msg) {
                logger("[region: " + regionName + "] " + msg);
            }
        },
        setupAwsConfig  = async.seq(
                            roleSetup.getLambdaRole,
                            awsConfigSetup.discoverRecorder,
                            s3Setup.getBucket,
                            snsSetup.getTopic,
                            roleSetup.getConfigRole,
                            lambdaSetup.createFunction,
                            snsSetup.createLambdaSubscription,
                            awsConfigSetup.setupRecorder,
                            awsConfigSetup.createSnapshot
                            );

    setupAwsConfig(setupData, function(err, result) {
            if (err) {
                setupData.logger("Failed to setup custom checks. Error: " + JSON.stringify(err));
                return callback(err);
            } else {
                setupData.logger(
                    "AWS Config setup and CloudInsight custom checks lambda function deployment completed.");
                return callback();
            }
    });
}

function isSupportedRegion(regionName) {
    "use strict";
    if (awsRegions.indexOf(regionName) === -1) {
        return false;
    }
    return true;
}

module.exports = deploy;
