/*
 * This should probably support all known asset types using a dictionary.
 */
var getAssetKey = function(awsRegion, resourceType, resourceId) {
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
        default:
            assetType = null;
            break;
    }
    if (assetType) {
        return "/aws/" + awsRegion + "/" + assetType +"/" + resourceId;
    } else {
        return null;
    }
};

module.exports = getAssetKey;
