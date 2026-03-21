import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGO_URI', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
  }
}

const hasAnyS3Config = [
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY'
].some((key) => Boolean(process.env[key]));

if (hasAnyS3Config) {
  const s3Required = ['AWS_REGION', 'AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  for (const key of s3Required) {
    if (!process.env[key]) {
      throw new Error(`Variavel de ambiente obrigatoria ausente para S3: ${key}`);
    }
  }
}

const hasAnyWebPushConfig = ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'].some((key) =>
  Boolean(process.env[key])
);

if (hasAnyWebPushConfig) {
  const webPushRequired = ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'];
  for (const key of webPushRequired) {
    if (!process.env[key]) {
      throw new Error(`Variavel de ambiente obrigatoria ausente para Web Push: ${key}`);
    }
  }
}

export const env = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  awsRegion: process.env.AWS_REGION || '',
  awsS3Bucket: process.env.AWS_S3_BUCKET || '',
  awsS3ProfilePrefix: process.env.AWS_S3_PROFILE_PREFIX || 'profile_image',
  awsS3PublicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL || '',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  awsSessionToken: process.env.AWS_SESSION_TOKEN || '',
  webPushPublicKey: process.env.WEB_PUSH_PUBLIC_KEY || '',
  webPushPrivateKey: process.env.WEB_PUSH_PRIVATE_KEY || '',
  webPushSubject: process.env.WEB_PUSH_SUBJECT || 'mailto:admin@sequelapp.local'
};
