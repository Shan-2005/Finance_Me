// ============================================================================
// FINANCE ME - AWS CONFIGURATION (100% Always Free Tier)
// Live Serverless Backend in Selected Region: ap-south-1
// ============================================================================

window.AWS_CONFIG = {
  // Set to true to switch the entire app backend from Supabase to AWS
  enabled: true,

  // AWS Selected Region
  region: 'ap-south-1',

  // Amazon Cognito User Pool ID (Optional - self-contained JWT auth is used by default)
  userPoolId: '',

  // Amazon Cognito App Client ID (Optional)
  clientId: '',

  // AWS Live API Gateway & Lambda Endpoint in selected Region ap-south-1
  lambdaFunctionUrl: 'https://n1ej1706me.execute-api.ap-south-1.amazonaws.com'
};
