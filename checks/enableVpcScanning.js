var config                  = require('../config.js'),
    AWS                     = require('aws-sdk'),
    async                   = require('async'),
    alSecurityApplianceName = "AlertLogic Security Appliance",
    alProtectionGroupName   = "Alert Logic Security Protection Group",
    checkName               = "enableVpcScanning",
    debug                   = true;

var enableVpcScanning   = function(params, callback) {
    "use strict";
    reportStatus("enableVpcScanning called");
    if (!validateParamaters(params)) {
        reportError("enableVpcScanning input parameters invalid. Params: " + JSON.stringify(params));
        return callback(null, false);
    }
    if (params.message.configurationItem.configurationItemStatus === "OK" ||
        params.message.configurationItem.configurationItemStatus === "ResourceDiscovered" ||
        params.message.configurationItem.configurationItemStatus === "ResourceDeleted") {
        
        switch (params.message.configurationItem.resourceType) {
            case "AWS::EC2::VPC":
                if (params.eventType !== 'snapshotEvent') {break;}
                return handleVpcEvent(params.inScope, params.awsRegion, params.vpcId, params.message, params.whitelist, callback);
            case "AWS::EC2::Instance":
                if (params.eventType !== 'configurationItem') {break;}
                return handleInstanceEvent(params.inScope, params.awsRegion, params.vpcId, params.message, params.whitelist, callback);
            default:
                reportError("Recieved event for unsupported '" + params.message.configurationItem.resourceType + "' resource type.");
                break;
        }
    }
    return callback(null, false);
};

/*
 * VPC Configuration Events handler
 */
function handleVpcEvent(inScope, awsRegion, vpcId, message, whitelist, callback) {
    "use strict";
    reportStatus("handleVpcEvent called. awsRegion: '" + awsRegion + "', vpcId: '" + vpcId + "'.");
    if (message.configurationItem.configurationItemStatus === "ResourceDeleted") {
        // Ignore resource deletion events
        reportDebug("Not processing ResourceDeleted for AWS::EC2::VPC resource type.");
        return callback(null, false);
    }

    AWS.config.update({region: awsRegion});
    var ec2     = new AWS.EC2({apiVersion: '2015-10-01'}),
        filter  = [{name: "Name", values: [alSecurityApplianceName]}];

    getInstances(filter, [], vpcId, ec2, function(err, appliances) {
        if (err) {
            reportStatus("Failed to get Alert Logic Security appliances. Error: " + JSON.stringify(err));
            return callback(null, false);
        }
        
        var relationships = message.configurationItem.relationships,
            instances = [];
        for(var i = 0; i < relationships.length; i++) { 
            var asset = relationships[i];
            if (asset.hasOwnProperty("resourceType") && asset.hasOwnProperty("resourceId") &&
                asset.resourceType === "AWS::EC2::Instance" && appliances.indexOf(asset.resourceId) < 0) {
                instances.push(asset.resourceId);
            }
        }

        if (inScope) {
            return protectVpc(vpcId, instances, whitelist, ec2, callback);
        } else {
            return unprotectVpc(vpcId, instances, ec2, callback);
        }
    });
}
 
/*
 * Instance Configuration Events handler
 */
function handleInstanceEvent(inScope, awsRegion, vpcId, message, whitelist, callback) {
    "use strict";
    reportStatus("handleInstanceEvent called. awsRegion: '" + awsRegion + "', vpcId: '" + vpcId + "'.");
    AWS.config.update({region: awsRegion});
    var ec2     = new AWS.EC2({apiVersion: '2015-10-01'}),
        tags    = [],
        handleGetInstances = null,
        i       = 0,
        res     = false;

    if (message.configurationItem.configurationItemStatus === "ResourceDeleted") {
        /*
         * Unprotect VPC when our environment's appliance is deleted in a VPC that isn't in scope.
         */
        var configration    = message.configurationItemDiff.changedProperties.Configuration.previousValue;
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
        var instanceId = message.configurationItem.resourceId;
        if (!inScope) {return callback(null, false);}
        if (matchResourceTags(message.configurationItem.tags, whitelist)) {
            return unprotectVpc(vpcId, [instanceId], ec2, callback);
        }

        handleGetInstances = function(err, result) {
            if (err) {
                reportError("Failed to get '" + vpcId + "' VPC instances. Error: " + JSON.stringify(err));
                return callback(err);
            } else {
                reportStatus("Appliance '" + instanceId + "' was launched for  protected '" +vpcId + "' VPC. Ensure VPC protection.");
                return protectVpc(vpcId, result, whitelist, ec2, callback);
            }
        };

        if (message.configurationItem.tags.hasOwnProperty("AlertLogic-EnvironmentID")) {
            if (message.configurationItem.tags["AlertLogic-EnvironmentID"] !== config.environmentId) {
                // Dont't protect our own appliances that belong to a different environment.
                return callback(null, false);
            }
            res = getInstances([], [{name: "AlertLogic-EnvironmentID"}], vpcId, ec2, handleGetInstances);
            return res;
        }
        // Protect instance
        reportDebug("Calling protect instances for '" + instanceId + "' in '" + vpcId + "'.");
        return protectVpc(vpcId, [instanceId], whitelist, ec2, callback);
    }
}
   
function protectVpc(vpcId, instances, whitelist, ec2, resultCallback) {
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
        function (groupId, callback) {
            applyWhitelisting(vpcId, instances, whitelist, ec2, callback);
        },
        function(result, callback) {
            var protectInstances = result.include;
            reportDebug("Enable protection for instances '" + protectInstances.toString() +
                        "' in '" + vpcId + "' VPC.");
            updateInstancesProtection(true, protectInstances, alProtectionGroup.GroupId, vpcId, ec2, function (err) {
                if (err) {return callback(err);}
                return callback(null, result.exclude);
            });
        },
        function(excludeInstances, callback) {
            if (!excludeInstances.length) {
                return callback(null);
            }
            reportDebug("Disabling protection for whitlisted instances '" + excludeInstances.toString() +
                        "' in '" + vpcId + "' VPC.");
            updateInstancesProtection(false, excludeInstances, alProtectionGroup.GroupId, vpcId, ec2, callback);
        }
    );
    updateProtection(vpcId, function(err, result) {
        if (err) {
            reportError("Failed to update '" + vpcId + "' VPC protection. Error: '" + JSON.stringify(err) + "'.");
            return resultCallback(err, false);
        }
        return resultCallback(null, false);
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
            removeVpcProtection(instances, data, vpcId, ec2, function (err, data) {
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
    reportDebug("Getting '" + alSecurityGroupName + "' for '" + vpcId + "'.");
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
                        reportDebug("'" + alSecurityGroupName + "' group id is '" + result + "' for '" + vpcId + "'.");
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
    async.waterfall([
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
        },
        function getEgressRules(callback) {
            executeAwsApi(ec2.describeSecurityGroups.bind(ec2), {GroupIds: [alProtectionGroup.GroupId]}, function(err, data) {
                if (err) {
                    reportError("Failed to call describe for '" + alProtectionGroup.GroupId + "'. Error: " +
                                JSON.stringify(err));
                    return callback(null, 'false');
                }
                var egressRules = data.SecurityGroups[0].IpPermissionsEgress;
                for (var i = 0; i < egressRules.length; i++) {
                    if (egressRules[i].IpProtocol !== "-1") {continue;}

                    for (var l = 0; l < egressRules[i].IpRanges.length; l++) {
                        if (egressRules[i].IpRanges[l].CidrIp === "0.0.0.0/0") {
                            reportStatus("Found egress rule open to the world. Scheduling removal.");
                            return callback(null, 'true');
                        }
                    }
                }
                reportStatus("Not found egress rule open to the world.");
                return callback(null, 'false');
            });
        },
        function updateEgressRules(removeEngressRule, callback) {
            if (removeEngressRule === 'false') {
                reportStatus("Skip removing egress rules for '" + alProtectionGroup.GroupId + "' security group.");
                return callback(null);
            }

            var params = {
                    GroupId: alProtectionGroup.GroupId,
                        IpPermissions:  [{
                            FromPort:   -1,
                            ToPort:     -1,
                            IpProtocol: "-1",
                            IpRanges:   [
                                {CidrIp: "0.0.0.0/0"}
                            ]
                        }]
                };
            executeAwsApi(ec2.revokeSecurityGroupEgress.bind(ec2), params, function(err, data) {
                if (err && err.code !== 'InvalidPermission.Duplicate') {
                    reportError("Failed to update egress rules for '" + alProtectionGroup.GroupId +
                                "'. Error: " + JSON.stringify(err));
                    return callback(null);
                } else {
                    reportStatus("Removed egress rule for '0.0.0.0/0' from '" + alProtectionGroup.GroupId + "'.");
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
            reportError("Failed to get Alert Logic Appliances list. Filters: '" + JSON.stringify(filters) +
                        "'. Error: " + JSON.stringify(err));
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

function removeVpcProtection(instancesSet, alProtectionGroup, vpcId, ec2, resultCallback) {
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
                        false, instances, alProtectionGroup.GroupId, vpcId, ec2, callback);
        },
        function (callback) {
            // remove references to the alSecurityGroup from the protection group
            revokeSecurityGroupProtection(alProtectionGroup, vpcId, ec2, callback);
        },
        function(alSecurityGroupId, callback) {
            for (var i = 0; i < alProtectionGroup.Tags.length; i++) {
                var tag = alProtectionGroup.Tags[i];
                if (tag.Key === "Name" || tag.Key === config.environmentId) {continue;}
                reportStatus("Not removing '" + alProtectionGroup.GroupId +
                             "' group since it provides protection for at least one more environment. EnvironmentId: '" +
                             tag.Key + "'.");
                return callback(null);
            }

            executeAwsApi(ec2.deleteSecurityGroup.bind(ec2), {"GroupId": alProtectionGroup.GroupId},
                function(err, data) {
                    if (err) {
                        reportError("Failed to deleted '" + alProtectionGroup.GroupId +
                                    "'. Error: " + JSON.stringify(err));
                        return callback(err);
                    } else {
                        reportStatus("Deleted '" + alProtectionGroup.GroupId + "'.");
                        // Delete Alert Logic's security group for this environment
                        executeAwsApi(ec2.deleteSecurityGroup.bind(ec2), {"GroupId": alSecurityGroupId},
                            function(err, data) {
                                if (err) {
                                    reportError("Failed to deleted '" + alSecurityGroupId+
                                                "'. Error: " + JSON.stringify(err));
                                } else {
                                    reportStatus("Deleted '" + alSecurityGroupId + "'.");
                                }
                                return callback(err, data);
                            }
                        );
                    }
                }
            );
        }
    ], function(err, data) {
        return resultCallback(err, data); 
    });
}

function revokeSecurityGroupProtection(alProtectionGroup, vpcId, ec2, resultCallback) {
    "use strict";
    async.waterfall([
        function (callback) {
            // get alert logic security group id
            getAlertLogicSecurityGroup(config.accountId, config.environmentId, vpcId, ec2, callback);
        },
        function (alSecurityGroupId, callback) {
            // get all the instances running with alert logic security group id
            var params = {
                Filters: [{"Name": "vpc-id", "Values": [vpcId]}, {"Name": "network-interface.group-id", "Values": [alSecurityGroupId]}]
            };
            reportDebug("Calling describeInstances with filter: '" + JSON.stringify(params) + "'");
            executeAwsApi(ec2.describeInstances.bind(ec2), params, function (err, data) {
                if (err) {
                    reportError("Failed to get Alert Logic Appliances list. Params: '" + JSON.stringify(params) +
                                "'. Error: " + JSON.stringify(err));
                    return callback(err);
                }
                // retrun null if there are instances running with alSecurityGroupId
                return callback(null, data.Reservations.length ? null : alSecurityGroupId);
            });
        },
        function (alSecurityGroupId, callback) {
            if (!alSecurityGroupId) {return callback(null, alSecurityGroupId);}

            // Remove ingress rule to alSecurity Group
            var params = {
                "GroupId": alProtectionGroup.GroupId,
                    "IpPermissions":  [{
                        "FromPort":   -1,
                        "ToPort":     -1,
                        "IpProtocol": "-1",
                        "UserIdGroupPairs": [
                            {"GroupId": alSecurityGroupId}
                        ]
                    }]
                };
            executeAwsApi(ec2.revokeSecurityGroupIngress.bind(ec2), params, function(err, data) {
                if (err) {
                    reportError("Failed to remove ingress rule to '" + alSecurityGroupId + "' from '" +
                                alProtectionGroup.GroupId + "'. Error: " + JSON.stringify(err));
                    return callback(err);
                }
                reportStatus("Successfully removed ingress rule to '" + alSecurityGroupId + "' from '" + alProtectionGroup.GroupId + "'.");
                return callback(null, alSecurityGroupId);
            });
        }
    ], function(err, alSecurityGroupId) {
        return resultCallback(err, alSecurityGroupId);
    });
}

/*
 * Filter out whitelisted instances
 */
function applyWhitelisting(vpcId, instances, whitelist, ec2, resultCallback) {
    "use strict";
    if (!instances.length) {
        return resultCallback(null, instances);
    }

    var filters     = getWhitelistEc2Filter(whitelist),
        whitelistedInstances = [],
        nextToken   = null;
    if (!filters.length) {
        return resultCallback(null, {"include": instances, "exclude": []});
    }

    reportStatus("Applying whitelist filter '" + JSON.stringify(filters) + "'.");
    async.eachSeries(filters, function(params, seriesCallback) {
        async.doWhilst(
            function(callback) {
                if (null !== nextToken) {
                    params['nextToken'] = nextToken;
                }

                executeAwsApi(ec2.describeInstances.bind(ec2), params, function(err, data) {
                    if (err) {
                        return callback(err);
                    }

                    for (var i = 0; i < data.Reservations.length; i++) {
                        var reservationInstances = data.Reservations[i].Instances;
                        for (var l = 0; l < reservationInstances.length; l++) {
                            var index = instances.indexOf(reservationInstances[l].InstanceId);
                            if (index >= 0) {
                                console.log("Whitelisting '%s' instance.", reservationInstances[l].InstanceId);
                                instances.splice(index, 1);
                                whitelistedInstances.push(reservationInstances[l].InstanceId);
                            }
                        }
                    }
                    nextToken = data.hasOwnProperty('nextToken') ? data.nextToken : null;
                    return callback(null);
                });
            },
            function() {
                return null !== nextToken;
            },
            function (err) {
                if (err) {
                    console.log("Failed to process whitelisted appliances. Error: %s", JSON.stringify(err));
                    return seriesCallback(err);
                }
                return seriesCallback(null);
            }
        );
        },
        function(err) {
            if (err) {
                console.log("Failed to process whitelisted appliances. Error: %s", JSON.stringify(err));
                return resultCallback(err);
            }
            return resultCallback(null, {"include": instances, "exclude": whitelistedInstances});
        }
    );
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
        if (err && (err.code === 'RequestLimitExceeded' || err.code === 'InternalError')) {
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

function matchResourceTags(tags, whitelist) {
    "use strict";
    for (var i = 0; i < whitelist.length; i++) {
        if (whitelist[i].type === 'tag' && tags.hasOwnProperty(whitelist[i].tag_key) && null !== tags[whitelist[i].tag_key].match(whitelist[i].tag_value)) {
            return true;
        }
    }
    return false;
}

function getWhitelistEc2Filter(whitelist) {
    "use strict";
    var filter    = [];
    for (var i = 0; i < whitelist.length; i++) {
        if (whitelist[i].type === 'tag') {
            filter.push({"Filters": [{"Name": "tag:" + whitelist[i].tag_key, "Values": [whitelist[i].tag_value]}]});
       }
    }
    reportStatus("EC2 Whitelist filter: " + JSON.stringify(filter));
    return filter;
}


function validateParamaters(params) {
    "use strict";
    return  params.hasOwnProperty('inScope') &&
            params.hasOwnProperty('awsRegion') &&
            params.hasOwnProperty('vpcId') &&
            params.hasOwnProperty('message') &&
            params.message.hasOwnProperty('configurationItem') &&
            params.message.configurationItem.hasOwnProperty('configurationItemStatus') &&
            params.hasOwnProperty('whitelist');
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
                 checkName + "] - ";
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
