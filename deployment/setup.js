/*
 * The setup performs the following actions:
 * Setup AWS Config recording for the specified region and return SNS Topic ARN configured for AWS Config.
 * If the AWS Config already setup properly, but doesn't have recording on or doesn publish updates to the SNS Topic,
 * ensure that recording is on and the Topic is setup.
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
    customChecksLambdaPkg   = '../target/ci_lambda_checks-67000001-C2D1E00F-4130-4022-A1C7-AC65F6EDED7F-0.0.3.zip',
    defaultFunctionName     = 'ci_custom_checks',
    defaultHandlerName      = 'index.handler';
    

var Environments = [
    {
        account: { awsAccountId: '481746159046', id: '67000001' },
        environment:
        {
            name: 'pavels_test',
            id: '0D7F7D05-1BAF-4FB7-89F1-F9511CAB0CE2',
            file: 'ci_lambda_checks-67000001-C2D1E00F-4130-4022-A1C7-AC65F6EDED7F-0.0.3.zip',
            regions: [ 'us-west-2', 'us-east-1' ]
        }
}];

deploy(Environments);

function deploy(environments) {
    "use strict";
    async.each(environments, deployEnvironment,
    function(err) {
        console.log("Finished deploying custom checks.");
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
        deployRegion(regionName, account, logger, function(err) {
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

function deployRegion(regionName, account, logger, callback) {
    "use strict";
    var AWS             = require('aws-sdk');
    AWS.config.loadFromPath('./aws_config.json');

    var setupData       = {
            aws:    AWS,
            region: regionName,
            setupRegion: regionName,
            accountId: account.awsAccountId,
            supportedRegions: awsRegions,
            lambda: {
                functionName:   defaultFunctionName, 
                roleName:       defaultLambdaRoleName,
                handler:        defaultHandlerName,
                runtime:        'nodejs',
                timeout:        300,
                zipFile: require('fs').readFileSync(
                            require('path').resolve(
                                __dirname, 
                                customChecksLambdaPkg))
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

