var s3bucketPrefix      = 'config-bucket-';

function getS3Bucket(setupData, resultCallback) {
    "use strict";
    var s3Endpoint  = getS3Endpoint(setupData.region),
        logger      = setupData.logger,
        bucketName  = "",
        s3;

    if (setupData.setupRegion !== setupData.region ||
        (setupData.deliveryChannels.length && setupData.deliveryChannels[0].s3BucketName.length) ) {
        /*
         * Configuration contained in the setupData is for another region then the one we are trying to setup.
         * Validate that the bucket indeed exists and use existing bucket for our region's AWS Config
         */
        bucketName  = setupData.deliveryChannels[0].s3BucketName;
        s3          = new setupData.aws.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01'});
        s3.getBucketLocation({Bucket: bucketName}, function (err, data) {
            if (err) {
                logger("getBucketLocation failed for bucket '" + bucketName + "', region '" + setupData.region + "'. Error: " + err);
                return resultCallback(err);
            } else {
                logger("Confirmed that bucket '" + bucketName + "' exists");
                resultCallback(null, setupData);
            }
        });
    } else {
        /* 
         * Setup new bucket
         */
        bucketName  = s3bucketPrefix + setupData.accountId;
        s3          = new setupData.aws.S3({apiVersion: '2006-03-01'});

        setupData.deliveryChannels = [{name: "default", 
                                       s3BucketName: bucketName}];
            
        s3.createBucket({Bucket: bucketName}, function(err, data) {
            if (err) {
                switch (err.statusCode) {
                    case 409:
                        return resultCallback(null, setupData);
                    default:
                        logger("createBucket failed for bucket '" + bucketName + "'. Error: " + JSON.stringify(err));
                        return resultCallback(err);
                }
            } else {
                logger("Created '" + bucketName + "' bucket for AWS Config");
                return getS3Bucket(setupData, resultCallback);
            }
        });
    }
}

function getS3Endpoint(region) {
    "use strict";
    if (region === 'us-east-1') { 
            return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}


module.exports = {
    getBucket: getS3Bucket
};
