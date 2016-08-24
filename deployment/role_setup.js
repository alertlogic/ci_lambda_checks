var async                       = require('async'),
    defaultConfigRoleName       = 'config-role',
    defaultConfigPolicyName     = 'cloud_insight_config-role_policy',
    assumeRolePolicyDocument    = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": "sts:AssumeRole",
                "Principal": {
                    "Service": ""
                },
                "Effect": "Allow",
                "Sid": ""
            }
        ]
    };

var setupConfigRole = function(setupData, resultCallback) {
    "use strict";
    /*
     * if the role exists, make sure to add our policy to it,
     * otherwise create AWS Config role and add our policy to it.
     */
    var roleName = null;

    if (setupData.configurationRecorders.length) {
        roleName = getRoleNameFromArn(setupData.configurationRecorders[0].roleARN);
    } else {
        roleName = defaultConfigRoleName;
    }

    setupRole(setupData, roleName, "config.amazonaws.com", getConfigPoilicies(setupData), function(err, result) {
        setupData.configurationRecorders[0].roleARN = result;
        resultCallback(null, setupData); 
    });
};

var setupLambdaRole = function(setupData, resultCallback) {
    "use strict";
    async.map(setupData.lambda,
        function(lambdaSetup, callback) { 
            var roleName = lambdaSetup.roleName;
            setupRole(setupData, roleName, "lambda.amazonaws.com", getLambdaPolicies(lambdaSetup),
                function(err, result) {
                    lambdaSetup.roleArn = result;
                    callback(null, lambdaSetup);
            });
        },
        function(err, result) {
            if (err) {return resultCallback(err, setupData);}
            setupData.lambda = result;
            return resultCallback(null, setupData);
        }
    );
};

function setupRole(setupData, roleName, serviceName, policies, resultCallback) {
    "use strict";
    var logger = setupData.logger;

    async.waterfall([
        function(callback) {
            /*
             * get/create role 
             */
            getRole(setupData, roleName, serviceName, function(err, roleArn) {
                return callback(err, roleArn);
            });
        },
        function(roleArn, callback) {
            /*
             * Setup role policies
             */
            addRolePolicies(setupData, roleName, policies, function(err) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, roleArn);
                }
            });
        }
    ],  function(err, result) {
        if (err) {
            logger("Failed to setup '" + roleName + "' role. Error: " + err);
            return resultCallback(err);
        } else {
            return resultCallback(null, result);
        }
    });
}

/*
 * Private functions
 */
function getRole(setupData, roleName, assumeRoleService, callback) {
    "use strict";
     /*
     * see if role already exists
     */
    var AWS     = setupData.aws,
        iam     = new AWS.IAM({apiVersion: '2010-05-08'}),
        logger  = setupData.logger;

    iam.getRole({RoleName: roleName}, function(err, data) {
        if (err) {
            switch (err.statusCode) {
                case 404:
                    /*
                     * create new role
                     */
                    var params = {
                        AssumeRolePolicyDocument: getAssumeRolePolicyDocument(assumeRoleService),
                        RoleName: roleName
                    };
                    return iam.createRole(params, function(err, data) {
                        if (err && err.statusCode === 409) {
                            var arn = "arn:aws:iam::" + setupData.accountId +
                                      ":role/" + roleName;
                            logger("'" + roleName + "' role already exists.");
                            return callback(null, arn);
                        } else if (err) {
                            logger("Failed to create '" + roleName + "' role. Error: " + JSON.stringify(err));
                            return callback(err, null);
                        } else {
                            logger("Successfully created '" + roleName + "' role.");
                            // return waitForRoleAvailability(iam, logger, roleName, callback);
                            return callback(null, data.Role.Arn);
                        }
                    });
                default:
                    logger("Failed to lookup '" + roleName + "' role. Error: " + JSON.stringify(err));
                    return callback(err, null);
            }
        } else {
            logger("Skip creating '" + roleName + "' role. Role already exists.");
            return callback(null, data.Role.Arn);
        }
    });
}

function addRolePolicies(setupData, roleName, policies, resultCallback) { 
    "use strict";
    var AWS     = setupData.aws,
        iam     = new AWS.IAM({apiVersion: '2010-05-08'}),
        logger  = setupData.logger;

    async.forEachOf(policies, function(policy, index, callback) {
        var params  = {
            RoleName: roleName,
            PolicyName: policy.name,
            PolicyDocument: JSON.stringify(policy.policyDocument)
        };
        iam.putRolePolicy(params, function(err, data) {
            if (err) {
                logger("putRolePolicy failed for '" +
                       policy.name + "' policy. Role: '" + roleName + "'. Error: " + err);
                return callback(err);
            } else {
                /*
                 * Find our policy in the list of policies.
                 * If one already exists, update it, otherwise create new one
                 */
                logger("Successfully added '" + policy.name + "' to '" + roleName + "'.");
                callback();
            }
        });
    }, function(err) {
        if (err) {
            return resultCallback(err);
        } else {
            return resultCallback(null);
        }
    });
}

function getRoleNameFromArn(roleArn) {
    "use strict";
    return roleArn.split('/').slice(-1)[0];
}

function getConfigPoilicies(setupData) {
    "use strict";
    var rolePolicyDocument = {
        "Version": "2012-10-17",
        "Statement": [
            {
              "Action": [
                "appstream:Get*",
                "autoscaling:Describe*",
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeStackEvents",
                "cloudformation:DescribeStackResource",
                "cloudformation:DescribeStackResources",
                "cloudformation:GetTemplate",
                "cloudformation:List*",
                "cloudfront:Get*",
                "cloudfront:List*",
                "cloudtrail:DescribeTrails",
                "cloudtrail:GetTrailStatus",
                "cloudwatch:Describe*",
                "cloudwatch:Get*",
                "cloudwatch:List*",
                "directconnect:Describe*",
                "dynamodb:GetItem",
                "dynamodb:BatchGetItem",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:DescribeTable",
                "dynamodb:ListTables",
                "ec2:Describe*",
                "elasticache:Describe*",
                "elasticbeanstalk:Check*",
                "elasticbeanstalk:Describe*",
                "elasticbeanstalk:List*",
                "elasticbeanstalk:RequestEnvironmentInfo",
                "elasticbeanstalk:RetrieveEnvironmentInfo",
                "elasticloadbalancing:Describe*",
                "elastictranscoder:Read*",
                "elastictranscoder:List*",
                "iam:List*",
                "iam:Get*",
                "kinesis:Describe*",
                "kinesis:Get*",
                "kinesis:List*",
                "opsworks:Describe*",
                "opsworks:Get*",
                "route53:Get*",
                "route53:List*",
                "redshift:Describe*",
                "redshift:ViewQueriesInConsole",
                "rds:Describe*",
                "rds:ListTagsForResource",
                "s3:Get*",
                "s3:List*",
                "sdb:GetAttributes",
                "sdb:List*",
                "sdb:Select*",
                "ses:Get*",
                "ses:List*",
                "sns:Get*",
                "sns:List*",
                "sqs:GetQueueAttributes",
                "sqs:ListQueues",
                "sqs:ReceiveMessage",
                "storagegateway:List*",
                "storagegateway:Describe*",
                "trustedadvisor:Describe*"
              ],
              "Effect": "Allow",
              "Resource": "*"
            },
            {
              "Effect": "Allow",
              "Action": [
                "s3:PutObject*"
              ],
              "Resource": [
                "arn:aws:s3:::" + setupData.deliveryChannels[0].s3BucketName + "/AWSLogs/" + setupData.accountId+ "/*"
              ],
              "Condition": {
                "StringLike": {
                  "s3:x-amz-acl": "bucket-owner-full-control"
                }
              }
            },
            {
              "Effect": "Allow",
              "Action": [
                "s3:GetBucketAcl"
              ],
              "Resource": "arn:aws:s3:::config-bucket-" + setupData.accountId
            },
            {
              "Effect": "Allow",
              "Action": "sns:Publish",
              "Resource": "arn:aws:sns:us-east-1:481746159046:config-topic"
            }
          ]
        };
    for(var i = 0; i < setupData.supportedRegions.length; i++) {
        rolePolicyDocument.Statement.push(getRegionSnsStatement(setupData.accountId, setupData.supportedRegions[i]));
    }
    return [
        {
            name: defaultConfigPolicyName,
            policyDocument: rolePolicyDocument 
        }
    ];
}

function getLambdaPolicies(lambdaSetup) {
    "use strict";
    var result = [
        {
            name: "basic_lambda_execution_policy",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "logs:DescribeLogStreams",
                            "logs:CreateLogGroup",
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        ],
                        "Resource": "arn:aws:logs:*:*:*"
                    },
                ]
            }
        },
        {
            name: "read_cloud_config_snapshot_policy",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "s3:GetObject",
                            "s3:GetBucketLocation"
                        ],
                        "Resource": [
                            "*"
                        ]
                    }
                ]
            }
        },
        {
            name: "enable_cloud_insight_scanning",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid":  "DiscoverScanningProtection",
                        "Effect": "Allow",
                        "Action": [
                            "ec2:DescribeInstances",
                            "ec2:DescribeInstanceAttribute",
                            "ec2:ModifyInstanceAttribute",
                            "ec2:DescribeSecurityGroups",
                            "ec2:CreateSecurityGroup",
                            "ec2:DeleteSecurityGroup",
                            "ec2:AuthorizeSecurityGroupIngress",
                            "ec2:RevokeSecurityGroupIngress",
                            "ec2:RevokeSecurityGroupEgress",
                            "ec2:CreateTags",
                            "ec2:DeleteTags"
                        ],
                        "Resource": [
                            "*"
                        ]
                    }
                ]
            }
        },
        {
            name: "aws_config_read_only_policy",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "config:Describe*",
                            "config:Get*",
                            "config:List*"
                        ],
                        "Resource": [
                            "*"
                        ]
                    }
                ]
            }
        },
        {
            name: "aws_inspector_read_only_policy",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "inspector:ListFindings",
                            "inspector:DescribeFindings",
                            "inspector:ListAssessmentTemplates",
                            "inspector:ListAssessmentRuns",
                            "inspector:DescribeAssessmentRuns",
                            "inspector:ListAssessmentRunAgents"
                        ],
                        "Resource": [
                            "*"
                        ]
                    }
                ]
            }
        }

    ];

    if (!lambdaSetup.hasOwnProperty("subscribe") || !lambdaSetup.subscribe) {
        var workerPolicy = {
            name: "lambda_worker_execution_policy",
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "CallWorker",
                        "Effect": "Allow",
                        "Action": [
                            "lambda:InvokeFunction"
                        ],
                        "Resource": [
                            "arn:aws:lambda:*:*:function:ci_checks_worker*"
                        ]
                    }
                ]
            }
        };
        result.push(workerPolicy);
    }

    return result;
}

function getRegionSnsStatement(accountId, region) {
    "use strict";
    return {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:" + region + ":" + accountId + ":config-topic"
    };
}

function getAssumeRolePolicyDocument(serviceName) {
    "use strict";
    assumeRolePolicyDocument.Statement[0].Principal.Service = serviceName;
    return JSON.stringify(assumeRolePolicyDocument);
}

module.exports = {
    getConfigRole: setupConfigRole,
    getLambdaRole: setupLambdaRole
};
