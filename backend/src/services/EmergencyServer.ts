import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { resolve } from 'node:path';

/**
 * ALERT BACKEND CORE
 * Processador de emergência de alta densidade.
 */

// Carregamento do contrato Protobuf
const PROTO_PATH = resolve(
  __dirname,
  '../../../src/core/security/emergency.proto',
);
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const alertProto = grpc.loadPackageDefinition(packageDefinition) as any;

const server = new grpc.Server();

server.addService(alertProto.alert.v1.EmergencyService.service, {
  // Implementação do Stream Bidirecional (DispatchSOS)
  dispatchSOS: (call: any) => {
    call.on('data', (signal: any) => {
      const startTime = Date.now();

      console.log(
        `[ALERTA RECEBIDO] Usuário: ${signal.user_id} | Nível: ${signal.level}`,
      );

      // Resposta instantânea via stream
      call.write({
        received: true,
        incident_id: `INC-${Math.random()
          .toString(36)
          .toUpperCase()
          .substring(2, 9)}`,
        instructions:
          'Protocolo de segurança ativado. Autoridades notificadas.',
      });

      console.log(
        `[PERF] Tempo de processamento backend: ${Date.now() - startTime}ms`,
      );
    });

    call.on('end', () => {
      call.end();
    });
  },
});

// Inicialização em porta de baixa latência
const PORT = '0.0.0.0:50051';
server.bindAsync(PORT, grpc.ServerCredentials.createInsecure(), () => {
  console.log(`[ALERT-CLOUD] Servidor gRPC operacional em ${PORT}`);
  server.start();
});
