// ============================================================================
// FINANCE ME - AWS CONFIGURATION (100% Always Free Tier)
// Fill in these values after deploying aws/template.yaml to your AWS account.
// ============================================================================

window.AWS_CONFIG = {
  // Set to true to switch the entire app backend from Supabase to AWS
  enabled: true,

  // AWS Region (e.g. 'ap-south-1' for Mumbai / India, or 'us-east-1')
  region: 'ap-south-1',

  // Amazon Cognito User Pool ID (from CloudFormation Outputs or Cognito Console)
  userPoolId: '',

  // Amazon Cognito App Client ID (from CloudFormation Outputs or Cognito Console)
  clientId: '',

  // AWS Lambda / API Gateway Endpoint (Public HTTPS endpoint with built-in CORS)
  lambdaFunctionUrl: 'https://n1ej1706me.execute-api.ap-south-1.amazonaws.com'
};
