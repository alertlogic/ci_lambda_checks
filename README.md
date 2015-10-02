##Cloud Insight Lambda Framework - Getting started  

###Configuring AWS  

You must enable AWS Config to gain the benefits of the Lambda Framework checks for your Cloud Insight environment.  More information about AWS Config can be found on the [AWS Config Product Page](https://aws.amazon.com/config/).  

- To enable AWS Config use the: [AWS Config Management Console](https://console.aws.amazon.com/config)  
- When configuring AWS Config make sure to choose and configure the Amazon SNS Topic option
- Build and deploy your Cloud Insight Lambda checks
- Subscribe the Lambda functions to your SNS Topic

###Mac OS X  Installation Requirements
*~ You must have installed XCode and accepted the licensing agreemment before continuing with this document ~*  

Install [Homebrew](http://brew.sh/)  
```$ ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"```  
*~ Homebrew allows us to easily install and manage packages with dependencies ~*  

Use [Homebrew](http://brew.sh/) to install [Node](http://nodejs.org/)  
```$ brew install node```  
*~ Javascript runtime required to run Lambda cli tools ~*  

###Linux Installation Requirements

Install [Node](http://nodejs.org/) latest Distribution from [Distributions](https://nodejs.org/dist/v4.1.1/)  
*~ Javascript runtime required to run Lambda cli tools ~*  

###Creating Your Environment

Clone this repository to somewhere under your home directory.  (we recommend ~/workspace)  
```$ git clone git@github.com:alertlogic/ci_lambda_checks.git ci_lambda_checks```  
```$ cd ci_lambda_checks```  

Execute the Lambda development environment installation script.  
```$ build/install.sh```  

###Working in your environment   

The [NPM](https://www.npmjs.org/) install process that was run earlier installed some [Node](http://nodejs.org/) modules that make the Lambda framework much more helpful than simple code checkouts.  Starting up the framework will enable real time linting, as well as the artifact build system.

###Creating New Checks  
Edit ./config.js "checks" key and add the name of your file in the ./checks folder.  
The new check configuration must have an "enabled" key with true or false, and may have any additional configuration you require.   
```./checks/sg.js``` is configured in ./config.js "checks" key as the key "sg".  
```  
"sg": {
    "enabled": true,
    "configuration": {
        "approved_ports": [
            443,
            22
        ]
    }
```  
This allows the index.handler to iterate through and execute any checks marked as ```"enabled": true``` to build a custom check library based on your deployment strategy.  

##Building for AWS    
run ```npm run build``` to create a versioned, distributable zip artifact.  
This artifcat is properly packaged to upload directly to AWS Lambda and work with the default configuration.  
run ```npm run release``` to update the version  

Upload that zip to Lambda  

###Test Security Group Event
```
{
  "Records": [
    {
      "EventSource": "aws:sns",
      "EventVersion": "1.0",
      "EventSubscriptionArn": "arn:aws:sns:us-east-1:481746159046:config-topic:5e0dea5e-f345-415c-8459-8f547c01739e",
      "Sns": {
        "Type": "Notification",
        "MessageId": "02034fef-90c5-5052-aa19-019c76cf2958",
        "TopicArn": "arn:aws:sns:us-east-1:481746159046:config-topic",
        "Subject": "[AWS Config:us-east-1] AWS::EC2::SecurityGroup sg-77707e10 Updated in Account 481746159046",
        "Message": "{\"configurationItemDiff\":{\"changedProperties\":{\"Configuration.IpPermissions.0\":{\"previousValue\":null,\"updatedValue\":{\"ipProtocol\":\"tcp\",\"fromPort\":23,\"toPort\":23,\"userIdGroupPairs\":[],\"ipRanges\":[\"0.0.0.0/0\"],\"prefixListIds\":[]},\"changeType\":\"CREATE\"}},\"changeType\":\"UPDATE\"},\"configurationItem\":{\"configurationItemVersion\":\"1.0\",\"configurationItemCaptureTime\":\"2015-09-16T21:48:57.411Z\",\"configurationStateId\":8,\"relatedEvents\":[\"236106d5-0547-4097-b008-a8da2df524ab\"],\"awsAccountId\":\"481746159046\",\"configurationItemStatus\":\"OK\",\"resourceId\":\"sg-77707e10\",\"ARN\":\"arn:aws:ec2:us-east-1:481746159046:security-group/sg-77707e10\",\"awsRegion\":\"us-east-1\",\"availabilityZone\":\"Not Applicable\",\"configurationStateMd5Hash\":\"1766acab5436a8115deabd7948de3eed\",\"resourceType\":\"AWS::EC2::SecurityGroup\",\"resourceCreationTime\":null,\"tags\":{\"Name\":\"Test\"},\"relationships\":[{\"resourceId\":\"vpc-4ba1f72e\",\"resourceType\":\"AWS::EC2::VPC\",\"name\":\"Is contained in Vpc\"}],\"configuration\":{\"ownerId\":\"481746159046\",\"groupName\":\"Test\",\"groupId\":\"sg-77707e10\",\"description\":\"Test\",\"ipPermissions\":[{\"ipProtocol\":\"tcp\",\"fromPort\":4000,\"toPort\":5000,\"userIdGroupPairs\":[],\"ipRanges\":[\"0.0.0.0/0\"],\"prefixListIds\":[]},{\"ipProtocol\":\"tcp\",\"fromPort\":23,\"toPort\":23,\"userIdGroupPairs\":[],\"ipRanges\":[\"0.0.0.0/0\"],\"prefixListIds\":[]},{\"ipProtocol\":\"tcp\",\"fromPort\":22,\"toPort\":22,\"userIdGroupPairs\":[],\"ipRanges\":[\"0.0.0.0/0\"],\"prefixListIds\":[]}],\"ipPermissionsEgress\":[{\"ipProtocol\":\"-1\",\"fromPort\":null,\"toPort\":null,\"userIdGroupPairs\":[],\"ipRanges\":[\"0.0.0.0/0\"],\"prefixListIds\":[]}],\"vpcId\":\"vpc-4ba1f72e\",\"tags\":[{\"key\":\"Name\",\"value\":\"Test\"}]}},\"notificationCreationTime\":\"2015-09-16T21:48:58.611Z\",\"messageType\":\"ConfigurationItemChangeNotification\",\"recordVersion\":\"1.2\"}",
        "Timestamp": "2015-09-16T21:48:58.755Z",
        "SignatureVersion": "1",
        "Signature": "TMTcY7ghJFsPH1n8Yp8eHj+iSgGlMmsZikrkZQoI3ooWLc9pjf9Jvyjkz6RWp/bioFzQxV5AN3FzndPxkZboDSWD9JIWDJmY9Z84Z83rcU6XWUfHYoTjYWsRjvEhM0XP0qUYBYMwv98qRqy24d33XOHqVcGl0A0Vk117pPoIJGfOANQEC9uvBoQR76Q6Eoi+wSMYzLx8AXItJzHRWDp6/76WV9sHh3V1Y+SlENjP0hT8xO3Ov81wPmwpZ//lF355YVXRjBoTtwed1NOVRJ9sea4ONo+7cMUuyXcYTG6lFcQvdm0wHKvf6kaqy3bXxG6UZNE3GNhxWPDGY/iUNVWLQw==",
        "SigningCertUrl": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-bb750dd426d95ee9390147a5624348ee.pem",
        "UnsubscribeUrl": "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:481746159046:config-topic:5e0dea5e-f345-415c-8459-8f547c01739e",
        "MessageAttributes": {}
      }
    }
  ]
}
```
