import { spawn } from 'child_process';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/shopify.config';

async function bootstrap(): Promise<void> {
  // Create Nest application with structured logging enabled.
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Global request validation guardrails.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const port = APP_CONFIG.port;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const uploadUiUrl = `http://localhost:${port}/inventory/upload-ui`;
  logger.log(`Inventory updater API running on port ${port}`);
  logger.log(`Upload UI: ${uploadUiUrl}`);

  if (APP_CONFIG.openUiOnStart) {
    openInBrowser(uploadUiUrl, logger);
  }
}

bootstrap();

function openInBrowser(url: string, logger: Logger): void {
  try {
    let child;

    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }

    child.unref();
    logger.log('Opened upload UI in default browser');
  } catch (error: unknown) {
    logger.warn(
      `Could not auto-open browser. Open manually: ${url}. Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
