var config                  = require('../config.js'),
    AWS                     = require('aws-sdk'),
    async                   = require('async'),
    alSecurityApplianceName = "AlertLogic Security Appliance",
    alProtectionGroupName   = "Alert Logic Security Protection Group",
    checkName               = "enableVpcScanning",
    debug                   = true;

var enableVpcScanning   = function(snapshotEvent, inScope, awsRegion, vpcId, rawMessage, callback)  {
    "use strict";
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDeleted") {
        
        switch (rawMessage.configurationItem.resourceType) {
            case "AWS::EC2::VPC":
                if (!snapshotEvent) {break;}
                return handleVpcEvent(inScope, awsRegion, vpcId, rawMessage, callback);
            case "AWS::EC2::Instance":
                if (snapshotEvent) {break;}
                return handleInstanceEvent(inScope, awsRegion, vpcId, rawMessage, callback);
            default:
                reportError("Recieved event for unsupported '" + rawMessage.configurationItem.resourceType + "' resource type.");
                break;
        }
    }
    return callback(null, false);
};

/*
 * VPC Configuration Events handler
 */
function handleVpcEvent(inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    if (rawMessage.configurationItem.configurationItemStatus === "ResourceDeleted") {
        // Ignore resource deletion events
        reportDebug("Not processing ResourceDeleted for AWS::EC2::VPC resource type.");
        return callback(null, false);
    }

    AWS.config.update({region: awsRegion});
    var ec2 = new AWS.EC2({apiVersion: '2015-10-01'}),
        filter = [{name: "Name", values: [alSecurityApplianceName]}];
    getInstances(filter, [], vpcId, ec2, function(err, appliances) {
        if (err) {
            reportStatus("Failed to get Alert Logic Security appliances. Error: " + JSON.stringify(err));
            return callback(null, false);
        }
        
        var relationships = rawMessage.configurationItem.relationships,
            instances = [];
        for(var i = 0; i < relationships.length; i++) { 
            var asset = relationships[i];
            if (asset.hasOwnProperty("resourceType") && asset.hasOwnProperty("resourceId") &&
                asset.resourceType === "AWS::EC2::Instance" && appliances.indexOf(asset.resourceId) < 0) {
                instances.push(asset.resourceId);
            }
        }

        if (inScope) {
            return protectVpc(vpcId, instances, ec2, callback);
        } else {
            return unprotectVpc(vpcId, instances, ec2, callback);
        }
    });
}
 
/*
 * Instance Configuration Events handler
 */
function handleInstanceEvent(inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    AWS.config.update({region: awsRegion});
    var ec2     = new AWS.EC2({apiVersion: '2015-10-01'}),
        tags    = [],
        handleGetInstances = null,
        i       = 0,
        res     = false;

    if (rawMessage.configurationItem.configurationItemStatus === "ResourceDeleted") {
        /*
         * Unprotect VPC when our environment's appliance is deleted in a VPC that isn't in scope.
         */
        var configration    = rawMessage.configurationItemDiff.changedProperties.Configuration.previousValue;
        handleGetInstances = function(err, result) {
            if (err) {
                reportError("Failed to get '" + vpcId + "' VPC instances. Error: " + JSON.stringify(err));
                return callback(err);
            } else {
                return unprotectVpc(vpcId, result, ec2, callback);
            }
        };
            
        tags = configration.tags;
        for (i = 0; i < tags.length; i++) {
            if (tags[i].key === "AlertLogic-EnvironmentID" &&
                tags[i].value === config.environmentId) {
                res = getInstances([], [{name: "AlertLogic-EnvironmentID"}], vpcId, ec2, handleGetInstances);
                return res;
            }
        }
        return callback(null, false);
    } else {
        /*
         * Enable scanning for an instance except Alert Logic Security Appliance
         */
        var instanceId = rawMessage.configurationItem.resourceId;
        if (!inScope) {return callback(null, false);}
        if (rawMessage.configurationItemDiff.changeType !== "CREATE") {return callback(null, false);}

        handleGetInstances = function(err, result) {
            if (err) {
                reportError("Failed to get '" + vpcId + "' VPC instances. Error: " + JSON.stringify(err));
                return callback(err);
            } else {
                reportStatus("Appliance '" + instanceId + "' was launched for  protected '" +vpcId + "' VPC. Ensure VPC protection.");
                return protectVpc(vpcId, result, ec2, callback);
            }
        };

        if (rawMessage.configurationItem.tags.hasOwnProperty("AlertLogic-EnvironmentID")) {
            if (rawMessage.configurationItem.tags["AlertLogic-EnvironmentID"] !== config.environmentId) {
                // Dont't protect our own appliances that belong to a different environment.
                return callback(null, false);
            }
            res = getInstances([], [{name: "AlertLogic-EnvironmentID"}], vpcId, ec2, handleGetInstances);
            return res;
        }
        // Protect instance
        reportDebug("Calling protect instances for '" + instanceId + "' in '" + vpcId + "'.");
        return protectVpc(vpcId, [instanceId], ec2, callback);
    }
}
   
function protectVpc(vpcId, instances, ec2, resultCallback) {
    "use strict";
    var alSecurityGroupId   = null,
        alProtectionGroup = null;
    
    if (!instances.length) {
        reportDebug("'" + vpcId + "' VPC has no instances in scope.");
        return resultCallback(null, false);
    }

    reportDebug("Protecting " + instances.length + " instances in '" + vpcId + "' VPC.");
    var updateProtection = async.seq(
        function (vpcId, callback) {
            var tags = [{name: "AlertLogic-EnvironmentID", values: [config.environmentId]}];
            getInstances(tags, [], vpcId, ec2, function (err, result) {
                if (err) {
                    return callback(err);
                } else {
                    return !result.length ? callback("VPC UNPROTECTED", null) : callback(null, result[0]);
                }
            });
        },
        function (instanceId, callback) {
            reportDebug("Alert Logic's Security Appliance instance id: '" + instanceId + "' " +
                         "in '" + vpcId + "'.");
            getAlertLogicSecurityGroup(config.accountId, config.environmentId, vpcId, ec2, callback);
        },
        function (data, callback) {
            alSecurityGroupId = data;
            reportDebug("Alert Logic's security group id: '" + alSecurityGroupId + "' in '" +
                         vpcId + "'.");
            getProtectionSecurityGroup(true, vpcId, ec2, callback);
        },
        function (data, callback) {
            alProtectionGroup = data;
            reportDebug("Alert Logic's Protection security group id: '" + data.GroupId + "'.");
            authorizeSecurityGroupProtection(
                config.accountId, config.environmentId, data, alSecurityGroupId, ec2, callback);
        },
        function(groupId, callback) {
            reportDebug("Enable protection for instances '" + instances.toString() + "' in '" + vpcId + "' VPC.");
            updateInstancesProtection(
                true, instances, alProtectionGroup.GroupId, vpcId, ec2, callback);
        }
    );
    updateProtection(vpcId, function(err, result) {
        return err ? resultCallback(err, false) : resultCallback(null, false);
    });
}

function unprotectVpc(vpcId, instances, ec2, resultCallback) {
    "use strict";
    /*
     * 1. Get protection group.
     * 2. Remove reference to the current environment.
     * 3. If there are no more references to any other environment in the Alert Logic Protection security group
     * modify all instances to not list Alert Logic Protection group.
     * 4. Remove Aler Logic Protection group
     */
    reportDebug("Unprotecting '" + instances.toString() + "' in '" + vpcId + "' VPC.");
    getProtectionSecurityGroup(false, vpcId, ec2, function (err, data) {
        if (err) {
            reportError("Failed to get '" + alProtectionGroupName + "' security group. Error: " + JSON.stringify(err));
            return resultCallback(null, false);
        }

        if (!data || !environmentProtected(data.Tags, config.accountId, config.environmentId)) {
            reportDebug("'" + vpcId + "' VPC isn't protected for the '" + config.environmentId + "' environment.");
            return resultCallback(null, false);
        }

        removeEnvironmentProtection(data, vpcId, config.environmentId, ec2, function (err, data) {
            if (err) {return resultCallback(err);}
            if (!data) {
                reportDebug("'" + alProtectionGroupName + "' has references to other environments. Not disabling scanning.");
                return resultCallback(null, false);
            }
            removeVpcProtection(instances, data.GroupId, vpcId, ec2, function (err, data) {
                return resultCallback(null, false);
            });
        });
    });
}

/*
 * Get Alert Logic's security appliance security group
 */
function getAlertLogicSecurityGroup(accountId, environmentId, vpcId, ec2, resultCallback) {
    "use strict";
    var alSecurityGroupName = getAlertLogicSecurityGroupName(accountId, environmentId),
        params = {
            Filters: [
                {Name: "vpc-id", Values: [vpcId]},
                {Name: "group-name", Values: [alSecurityGroupName]}
            ]
        },
        result = null;

    async.during(
        function describeGroup(callback) {
            executeAwsApi(ec2.describeSecurityGroups.bind(ec2), params, function(err, data) {
                if (err) {
                    // TODO: Add handling for 404
                    reportError("Failed to get Alert Logic security group. Error: " + JSON.stringify(err));
                    return callback(err);
                } else {
                    // Return Alert Logic security group id
                    if (data.SecurityGroups.length) {
                        result = data.SecurityGroups[0].GroupId;
                        return callback(null, false);
                    } else {
                        if (alSecurityGroupName === getAlertLogicSecurityGroupName(accountId, environmentId)) {
                            reportDebug("Alert Logic Security Group is missing. Trying legacy mode.");
                            return callback(null, true);
                        }
                        reportError("Protected '" + vpcId + "' vpc doesn't have '" + getAlertLogicSecurityGroupName(accountId, environmentId) +
                                    "' or '" + getAlertLogicSecurityLegacyGroupName(accountId) + "'.");
                        return callback("VPC UNPROTECTED");
                    }
                }
            });
        },
        function useLegacyGroup(callback) {
            alSecurityGroupName = getAlertLogicSecurityLegacyGroupName(accountId);
            params.Filters = [
                {Name: "vpc-id", Values: [vpcId]},
                {Name: "group-name", Values: [alSecurityGroupName]}
            ];
            callback();
        },
        function (err) {
            return resultCallback(err, result);
        }
    );
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

    reportDebug("Getting '" + alProtectionGroupName + "' in '" + vpcId + "'.");
    async.during(
        function describeGroup(callback) {
            executeAwsApi(ec2.describeSecurityGroups.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to get '" + alProtectionGroupName + "'. Error: " + JSON.stringify(err));
                    return callback(err, false);
                } else {
                    if (data.SecurityGroups.length) {
                        result = data.SecurityGroups[0];
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
                    var params = {
                        "Resources": [data.GroupId],
                        "Tags": [
                            {"Key": "Name", "Value": alProtectionGroupName}
                        ]
                    };
                    // Tag Alert Logic Protection security group
                    executeAwsApi(ec2.createTags.bind(ec2), params, function(err, data) {
                        return callback(null);
                    });
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
                    reportDebug("Assigned '" + environmentId + "' to '" + alProtectionGroup.GroupId + "' security group.");
                    return callback(null);
                }
            });
        },
        function updateIngressRules(callback) {
            // TODO: Check of the alSecurityGroupId already authorized
            if (ingressEnabled(alProtectionGroup.IpPermissions, alSecurityGroupId)) {
                reportDebug("Ingress rule for '" + alSecurityGroupId + "' already exists in '" + alProtectionGroup.GroupId + "' security group.");
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

function getInstances(includeTags, excludeTags, vpcId, ec2, callback) {
    "use strict";
    var filters = [{"Name": "vpc-id", "Values": [vpcId]}];
    for (var i = 0; i < includeTags.length; i++) {
        filters.push({"Name": "tag:" + includeTags[i].name, "Values": includeTags[i].values});
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
                    if (!hasTags(excludeTags, instances[l].Tags)) {
                        result.push(String(instances[l].InstanceId));
                    }
                }
            }
            return callback(null, result);
        }
    });
}

/*
 * Remove environment reference from the Alert Logic Protection group.
 */
function removeEnvironmentProtection(alProtectionGroup, vpcId, environmentId, ec2, resultCallback) {
    "use strict";
    async.waterfall([
        function (callback) {
            // Delete environment id tag.
            var params = {
                "Resources": [alProtectionGroup.GroupId],
                "Tags": [{"Key": environmentId}]
            };
            executeAwsApi(ec2.deleteTags.bind(ec2), params, function(err, data) {
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

function removeVpcProtection(instancesSet, alProtectionGroupId, vpcId, ec2, resultCallback) {
    "use strict";
    async.waterfall([
        function (callback) {
            if (instancesSet.length) {
                return callback(null, instancesSet);
            }
            // get instances for this VPC
        },
        function (instances, callback) {
            reportDebug("Disabling protection for instances in '" + vpcId + "' VPC. Exclude: '" +
                         instances.toString() + "'.");
            updateInstancesProtection(
                        false, instances, alProtectionGroupId, vpcId, ec2, callback);
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

/*
 * Add Alert Logic Protection Security Group
 */
function updateInstancesProtection(enable, instances, groupId, vpcId, ec2, resultCallback) {
    "use strict";
    async.each(instances, function(instanceId, callback) {
        // Exclude Alert Logic's appliances from the list of instances to enable scanning for.
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
                        reportDebug("'" + instanceId + "' is already enabled for scanning.");
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
                        reportStatus("Successfully " + (enable ? "enabled" : "disabled") + " scanning of '" +
                                     instanceId + "' instance.");
                        return callback(null);
                    }
                }); 
            }
        });
    }, function(err) {
        if (err) {
            reportError('error', "Failed to " + (enable ? "enabled" : "disabled") +
                        " scannning of instances in '" + vpcId + "'. Error: " + JSON.stringify(err));
            return resultCallback(err);
        } else {
            reportStatus("Successfully " + (enable ? "enabled" : "disabled") + " scanning of instances in '" + vpcId+ "'.");
            return resultCallback(null);
        }
    });
}

function environmentProtected(tags, accountId, environmentId) {
    "use strict";
    for (var i = 0; i < tags.length; i++) {
        if (tags[i].Key === environmentId && tags[i].Value === accountId) {
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

function getAlertLogicSecurityGroupName(accountId, environmentId) {
    "use strict";
    return "Alert Logic Security Group " + accountId + "_" + environmentId;
}

function getAlertLogicSecurityLegacyGroupName(accountId) {
    "use strict";
    return "Alert Logic Security Group " + accountId;
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

function hasTags(compareTags, tags) {
    "use strict";
    if (!compareTags.length) {return false;}

    for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        for (var l = 0; l < compareTags.length; l++) {
            if (compareTags[l].name === tag.Key) {
                if (!compareTags[l].hasOwnProperty("values")) {return true;} 
                if (compareTags[l].values.indexOf(tag.Value) >= 0) {return true;}
            }
        }
    }
    return false;
}

function reportDebug(msg) {
    "use strict";
    return log('debug', msg);
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
        case 'debug':
            if (debug) {
                console.log(prefix + msg);
            }
            break;
        case 'error':
            console.error(prefix + msg);
            break;
        default:
            console.log(prefix + msg);
    }
}

module.exports = enableVpcScanning;
