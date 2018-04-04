/*
 * This should probably support all known asset types using a dictionary.
 */
var api               = require('./api.js'),
    getAssetKey = function(awsRegion, resourceType, resourceId) {
        "use strict";
        var assetType;
        switch (resourceType) {
            case "AWS::EC2::Instance":
                assetType = "host";
                break;
            case "AWS::EC2::SecurityGroup":
                assetType = "sg";
                break;
            case "AWS::EC2::Subnet":
                assetType = "subnet";
                break;
            case "AWS::EC2::VPC":
                assetType = "vpc";
                break;
            case "AWS::EC2::NetworkAcl":
                assetType = "acl";
                break;
            case "AWS::EC2::RouteTable":
                assetType = "route";
                break;
            case "AWS::EC2::InternetGateway":
                assetType = "igw";
                break;
            default:
                assetType = null;
                break;
        }
        if (assetType) {
            return "/aws/" + awsRegion + "/" + assetType +"/" + resourceId;
        } else {
            return null;
        }
    },

    getRegionsInScope = function(token, accountId, environmentId, callback) {
        "use strict";
        var params = {
            'service': 'assets',
            'endpoint': 'environments',
            'accountId': accountId,
            'id': environmentId,
            'prefix': 'assets',
            'query': {
                "asset_types": "region",
                "scope": "true"
            }
        };
        api.getMany(token, params, callback);
    },

    getVpcsInScope = function(token, accountId, environmentId, region, callback) {
        "use strict";
        var params = {
            'service': 'assets',
            'endpoint': 'environments',
            'accountId': accountId,
            'id': environmentId,
            'prefix': 'assets',
            'query': {
                "asset_types": "r:region,v:vpc",
                "r.key": "/aws/" + region,
                "return_types": "v",
                "scope": "true"
            } 
        };
        api.getMany(token, params, callback);
    };

module.exports = {
    getAssetKey: getAssetKey,
    getRegionsInScope: getRegionsInScope,
    getVpcsInScope: getVpcsInScope
};
