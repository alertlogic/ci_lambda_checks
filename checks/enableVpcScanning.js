var config  = require('../config.js'),
    AWS                     = require('aws-sdk'),
    async                   = require('async'),
    alSecurityGroupName     = "AlertLogic Security Appliance",
    alProtectionGroupName   = "Alert Logic Security Protection Group",
    checkName               = "enableVpcScanning";

var enableVpcScanning   = function(inScope, rawMessage)  {
    "use strict";
    // reportStatus("checkRawMessage: " + JSON.stringify(rawMessage));
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered") {

        var awsRegion           = rawMessage.configurationItem.awsRegion,
            vpcId               = rawMessage.configurationItem.resourceId,
            alSecurityGroupId   = null,
            alProtectionGroup = null;

        AWS.config.update({region: awsRegion});
        var ec2                 = new AWS.EC2({apiVersion: '2015-10-01'}),
            updateProtection;

        if (inScope) {
            updateProtection = async.seq(
                function (vpcId, callback) {
                    var tags = [{name: "AlertLogic-EnvironmentID", values: [config.environmentId]}];
                    getAlertLogicAppliances(tags, vpcId, ec2, function (err, result) {
                        if (err) {
                            return callback(err);
                        } else {
                            return !result.length ? callback("VPC UNPROTECTED", null) : callback(null, result[0]);
                        }
                    });
                },
                function (instanceId, callback) {
                    reportStatus("Alert Logic's instance id: '" + instanceId + "'.");
                    getAlertLogicSecurityGroup(config.accountId, vpcId, ec2, callback);
                },
                function (data, callback) {
                    alSecurityGroupId = data;
                    reportStatus("Alert Logic's security group id: '" + alSecurityGroupId + "' in '" +
                                 vpcId + "'.");
                    getProtectionSecurityGroup(true, vpcId, ec2, callback);
                },
                function (data, callback) {
                    alProtectionGroup = data;
                    reportStatus("Alert Logic's Protection security group id: '" + data.GroupId + "'.");
                    authorizeSecurityGroupProtection(
                        config.accountId, config.environmentId, data, alSecurityGroupId, ec2, callback);
                },
                function(groupId, callback) {
                    var tags = [{name: "Name", values: [alSecurityGroupName]}];
                    getAlertLogicAppliances(tags, vpcId, ec2, callback);
                },
                function(instances, callback) {
                    reportStatus("Enable protection for instances in '" + vpcId + "' VPC. Exclude: '" +
                                 instances.toString() + "'.");
                    updateInstancesProtection(
                        true, rawMessage.configurationItem, alProtectionGroup.GroupId, vpcId, instances, ec2, callback);
                }
            );
            updateProtection(vpcId, function(err, result) {
                if (err) {
                    reportError("Failed to enable scannning of instances in '" + vpcId + "'. Error: " +
                                  JSON.stringify(err));
                    return false;
                } else {
                    reportStatus("Successfully enabled scanning of instances in '" + vpcId + "'.");
                    return false;
                }
            });
        } else {
            /*
             * 1. Get protection group.
             * 2. Remove reference to the current environment.
             * 3. If there are no more references to any other environment in the Alert Logic Protection security group
             * modify all instances to not list Alert Logic Protection group.
             * 4. Remove Aler Logic Protection group
             */
            getProtectionSecurityGroup(false, vpcId, ec2, function (err, data) {
                if (err) {
                    reportError("Failed to get '" + alProtectionGroupName + "' security group. Error: " + JSON.stringify(err));
                    return false;
                }

                if (!data || !environmentProtected(data.Tags, config.accountId, config.environmentId)) {
                    reportStatus("'" + vpcId + "' VPC isn't protected for the '" + config.environmentId + "' environment.");
                    return false;
                }

                removeEnvironmentProtection(data, vpcId, config.environmentId, ec2, function (err, data) {
                    if (err) {return false;}
                    if (!data) {
                        reportStatus("'" + alProtectionGroupName + "' has references to other environments. Not disabling scanning.");
                        return false;
                    }
                    removeVpcProtection(rawMessage.configurationItem, data.GroupId, vpcId, ec2, function (err, data) {
                        return false;
                    });
                });
            });
            return false;
        }
    } else {
        return false;
    }
};

/*
 * Get Alert Logic's security appliance security group
 */
function getAlertLogicSecurityGroup(accountId, vpcId, ec2, callback) {
    "use strict";
    var alSecurityGroupName = "Alert Logic Security Group " + accountId,
        params = {
            Filters: [
                {Name: "vpc-id", Values: [vpcId]},
                {Name: "group-name", Values: [alSecurityGroupName]}
            ]
        };

    executeAwsApi(ec2.describeSecurityGroups.bind(ec2), params, function(err, data) {
        if (err) {
            // TODO: Add handling for 404
            reportError("Failed to get Alert Logic security group. Error: " + JSON.stringify(err));
            return callback(err);
        } else {
            // Return Alert Logic security group id
            if (data.SecurityGroups.length) {
                var groupId = data.SecurityGroups[0].GroupId;
                return callback(null, groupId);
            } else {
                reportError("Protected '" + vpcId + "' vpc doesn't have '" + alSecurityGroupName + "'.");
                return callback("VPC UNPROTECTED");
            }
        }
    });
}

/*
 * Make sure that Alert Logic Protection group for this vpc exists
 */
function getProtectionSecurityGroup(createFlag, vpcId, ec2, resultCallback) {
    "use strict";
    var params = {
            Filters: [
                {Name: "vpc-id", Values: [vpcId]},
                {Name: "group-name", Values: [alProtectionGroupName]}
            ]
        },
        result = null;

    reportStatus("Getting '" + alProtectionGroupName + "' in '" + vpcId + "'.");
    async.during(
        function describeGroup(callback) {
            executeAwsApi(ec2.describeSecurityGroups.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to get '" + alProtectionGroupName + "'. Error: " + JSON.stringify(err));
                    return callback(err, false);
                } else {
                    if (data.SecurityGroups.length) {
                        result = data.SecurityGroups[0];
                        reportStatus("Got Alert Logic security group. Result: " + JSON.stringify(result));
                    }
                    return createFlag ? callback(null, result === null) : callback(null, false);
                }
            });
        },
        function createGroup(callback) {
            var params = {
                    Description: alProtectionGroupName,
                    GroupName: alProtectionGroupName,
                    VpcId: vpcId
                };
            executeAwsApi(ec2.createSecurityGroup.bind(ec2), params, function(err, data) {
                if (err && err.code !== 'InvalidGroup.Duplicate') {
                    reportError("Failed to created '" + alProtectionGroupName + "'. Error: " + JSON.stringify(err));
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        },
        function (err) {
            return resultCallback(err, result);
        }
    );
}

function authorizeSecurityGroupProtection(accountId, environmentId, alProtectionGroup, alSecurityGroupId, ec2, resultCallback) {
    "use strict";
    async.parallel([
        function updateTags(callback) {
            var params = {
                "Resources": [alProtectionGroup.GroupId],
                "Tags": [
                    {"Key": environmentId, "Value": accountId}
                ]
            };
            executeAwsApi(ec2.createTags.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to add environment tag to '" + alProtectionGroup.GroupId +
                                "'. Error: " + JSON.stringify(err));
                    return callback(err);
                } else {
                    reportStatus("Assigned '" + environmentId + "' to '" + alProtectionGroup.GroupId + "' security group.");
                    return callback(null);
                }
            });
        },
        function updateIngressRules(callback) {
            // TODO: Check of the alSecurityGroupId already authorized
            if (ingressEnabled(alProtectionGroup.IpPermissions, alSecurityGroupId)) {
                reportStatus("Ingress rule for '" + alSecurityGroupId + "' already exists in '" + alProtectionGroup.GroupId + "' security group.");
                return callback(null);
            }
            var params = {
                    GroupId: alProtectionGroup.GroupId,
                        IpPermissions:  [{
                            FromPort:   -1,
                            ToPort:     -1,
                            IpProtocol: "-1",
                            UserIdGroupPairs: [
                                {GroupId: alSecurityGroupId}
                            ]
                        }]
                };
            executeAwsApi(ec2.authorizeSecurityGroupIngress.bind(ec2), params, function(err, data) {
                if (err && err.code !== 'InvalidPermission.Duplicate') {
                    reportError("Failed to update ingress rules for '" + alProtectionGroup.GroupId +
                                "'. Error: " + JSON.stringify(err));
                    return callback(err);
                } else {
                    reportStatus("Added ingress rule for '" + alSecurityGroupId + "' to '" + alProtectionGroup.GroupId + "'.");
                    return callback(null);
                }
            });
        }
    ], function (err, result) {
        return resultCallback(err, alProtectionGroup.GroupId);
    });
}

function getAlertLogicAppliances(tags, vpcId, ec2, callback) {
    "use strict";
    var filters = [{"Name": "vpc-id", "Values": [vpcId]}];
    for (var i = 0; i < tags.length; i++) {
        filters.push({"Name": "tag:" + tags[i].name, "Values": tags[i].values});
    }
    executeAwsApi(ec2.describeInstances.bind(ec2), {"Filters": filters}, function (err, data) {
        if (err) {
            reportError("Failed to get Alert Logic Appliances list. Error: " + JSON.stringify(err));
            return callback(err);
        }
        else {
            var result = [];
            for (var i = 0; i < data.Reservations.length; i++) {
                var instances = data.Reservations[i].Instances;
                for (var l = 0; l < instances.length; l++) {
                    result.push(String(instances[l].InstanceId));
                }
            }
            return callback(null, result);
        }
    });
}

/*
 * Add Alert Logic Protection Security Group
 */
function updateInstancesProtection(enable, configurationItem, groupId, vpcId, instances, ec2, resultCallback) {
    "use strict";
    async.each(configurationItem.relationships, function(asset, callback) {
        // Exclude Alert Logic's appliances from the list of instances to enable scanning for.
        if (asset.hasOwnProperty("resourceType") && asset.hasOwnProperty("resourceId") &&
            asset.resourceType === "AWS::EC2::Instance" && instances.indexOf(asset.resourceId) < 0) {
            var instanceId = asset.resourceId;
            reportStatus("Getting instance attributes for '" + instanceId + "'.");

            var params = {Attribute: 'groupSet', InstanceId: instanceId};
            executeAwsApi(ec2.describeInstanceAttribute.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to get '" + instanceId + "' instance attributes. Error: " +
                                JSON.stringify(err));
                    return callback(null);
                } else {
                    var groups = data.Groups,
                        groupSet = [];

                    if (enable) {
                        groupSet = groups.map(function(group) {return group.GroupId;});
                        if (groupSet.indexOf(groupId) >= 0) {
                            reportStatus("'" + instanceId + "' is already enabled for scanning.");
                            return callback(null); 
                        }
                        groupSet.push(groupId);
                    } else {
                        for (var i = 0; i < groups.length; i++) {
                            if (groups[i].GroupId === groupId) {
                                continue;
                            }
                            groupSet.push(groups[i].GroupId);
                        } 
                    }
                    var params = {InstanceId: instanceId, Groups: groupSet};
                    executeAwsApi(ec2.modifyInstanceAttribute.bind(ec2), params, function(err, data) {
                        if (err) {
                            reportError("Failed to update '" + instanceId + "' instance attributes. Error: " +
                                        JSON.stringify(err));
                            return callback(null);
                        } else {
                            reportStatus("Successfully " + enable ? "enabled" : "disabled" + " scanning of '" +
                                         instanceId + "' instance.");
                            return callback(null);
                        }
                    }); 
                }
            });
        } else {
            return callback(null);
        }
    }, function(err) {
        if (err) {
            reportError('error', "Failed to " + enable ? "enabled" : "disabled" +
                        " scannning of instances in '" + vpcId + "'. Error: " + JSON.stringify(err));
            return resultCallback(err);
        } else {
            reportStatus("Successfully " + enable ? "enabled" : "disabled" + " scanning of instances in '" + vpcId+ "'.");
            return resultCallback(null);
        }
    });
}

/*
 * Remove environment reference from the Alert Logic Protection group.
 */
function removeEnvironmentProtection(alProtectionGroup, vpcId, ec2, environmentId, resultCallback) {
    "use strict";
    async.waterfall([
        function (callback) {
            // Delete environment id tag.
            var params = {
                "Resources": alProtectionGroup.GroupId,
                "Tags": [{"Key": environmentId}]
            };
            executeAwsApi(ec2.removeTags.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to remove '" + environmentId + "' environment tag from '" + alProtectionGroupName +
                                "'. Error: " + JSON.stringify(err));
                }
                return callback(err);
            }); 
        },
        function(callback) {
            // Get the protection group again.
            // If there are no more environments to protect, remove references to it from instances and remove the group.
            getProtectionSecurityGroup(false, vpcId, ec2, function (err, data) {
                if (err) {
                    reportError("Failed to get '" + alProtectionGroupName + "' security group. Error: " + JSON.stringify(err));
                    return callback(err);
                }
                return callback (null, data.Tags.length ? data : null); 
            });
        }
    ], function(err, result) {
        return resultCallback(err, result);
    });
}

/*
 * Disable scanning by Alert Logic Security Appliance
 */
function removeVpcProtection(configurationItem, alProtectionGroupId, vpcId, ec2, resultCallback) {
    "use strict";
    async.waterfall([
        function (callback) {
            var tags = [{name: "Name", values: [alSecurityGroupName]}];
            getAlertLogicAppliances(tags, vpcId, ec2, callback);
        },
        function (instances, callback) {
            reportStatus("Disabling protection for instances in '" + vpcId + "' VPC. Exclude: '" +
                         instances.toString() + "'.");
            updateInstancesProtection(
                        false, configurationItem, alProtectionGroupId, vpcId, instances, ec2, callback);
        },
        function(result, callback) {
            executeAwsApi(ec2.deleteSecurityGroup.bind(ec2), {"GroupId": alProtectionGroupId}, function(err, data) {
                if (err) {
                    reportError("Failed to deleted '" + alProtectionGroupId + "'. Error: " + JSON.stringify(err));
                } else {
                    reportStatus("Deleted '" + alProtectionGroupId + "'.");
                } 
                return callback(null);
            });
        }
    ], function(err) {
        return resultCallback(err); 
    });
}

function environmentProtected(tags, accountId, environmentId) {
    "use strict";
    for (var i = 0; i < tags.length; i++) {
        if (tags[i].Key === environmentId && tags[i].Values === accountId) {
            return true;
        }
    } 
    return false;
}

function ingressEnabled(rules, groupId) {
    "use strict";
    for (var i = 0; i < rules.length; i++) {
        if (rules[i].IpProtocol === "-1") {
            var pairs = rules[i].UserIdGroupPairs;
            for (var l = 0; l < pairs.length; l++) {
                if (pairs[l].GroupId === groupId) {
                    return true;
                }
            }
        }
    }
    return false;
}

function executeAwsApi(fun, params, callback) {
    "use strict";
    return executeAwsApiEx(fun, params, callback, null, 10);
}

function executeAwsApiEx(fun, params, callback, lastError, retries) {
    "use strict";
    if (!retries) {
        reportStatus("Maximum retries number reached... fun: " + fun.toString() + ", params: '" + JSON.stringify(params) + "'.");
        return callback(lastError, null);
    }

    fun(params, function(err, data) {
        if (err && err.code === 'RequestLimitExceeded') {
            setTimeout(function() {
                return executeAwsApiEx(fun, params, callback, err, retries - 1);
            }, 3000);
        } else {
            return callback(err, data);
        }
    });
}
function reportStatus(msg) {
    "use strict";
    return log('ok', msg);
}

function reportError(msg) {
    "use strict";
    return log('error', msg);
}

function log(status, msg) {
    "use strict";
    var prefix = "[" + config.accountId + ":" +
                 config.environmentId + ":" +
                 checkName + "]";
    switch (status) {
        case 'error':
            console.error(prefix + msg);
            break;
        default:
            console.log(prefix + msg);
    }
}

module.exports = enableVpcScanning;
