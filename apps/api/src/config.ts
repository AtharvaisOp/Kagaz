const DEFAULT_PORT = 4000;
const DEFAULT_ORIGINS = ['http://localhost:5173'];

export interface AppConfig {
  port: number;
  allowedOrigins: string[];
}

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const requestedPort = Number(environment.PORT ?? DEFAULT_PORT);
  const port =
    Number.isInteger(requestedPort) && requestedPort > 0
      ? requestedPort
      : DEFAULT_PORT;
  const configuredOrigins = environment.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port,
    allowedOrigins:
      configuredOrigins && configuredOrigins.length > 0
        ? configuredOrigins
        : DEFAULT_ORIGINS,
  };
}
