# 🛑 Procedimento de Parada de Emergência - Teste de Carga Barato

## Visão Geral

Este documento descreve como parar imediatamente um teste de carga em execução e como desligar qualquer infraestrutura temporária utilizada.

## ⚡ Parada Imediata do Teste

### Se estiver rodando localmente:

```bash
# Pressione Ctrl+C no terminal onde o teste está rodando
Ctrl+C

# Se não responder, force a parada:
Ctrl+Z
kill %1

# Ou encontre o PID e mate o processo:
ps aux | grep node
kill -9 <PID>
```

### Se estiver rodando em servidor remoto (Render, etc.):

```bash
# Acesse o dashboard do Render
# Vá em "Deployments" > selecione o serviço > "Cancel Deployment"

# Ou via CLI do Render (se configurado):
render service cancel-deployment <service-id>
```

## 📊 Verificar Status Após Parada

```bash
# Verifique se o processo Node.js foi encerrado:
ps aux | grep "load-smoke-cheap"
ps aux | grep "check-scale-readiness"

# Verifique portas em uso (caso o backend tenha travado):
netstat -ano | findstr :5005  # Windows
lsof -i :5005                 # Linux/Mac
```

## 🔧 Limpeza de Infraestrutura Temporária

### Redis Temporário (se foi criado)

```bash
# Se usou Docker:
docker ps | grep redis
docker stop <container-id>
docker rm <container-id>

# Se usou Redis local:
redis-cli shutdown
```

### Variáveis de Ambiente Temporárias

Remova do `.env` ou desfaça as exportações:

```bash
# Se exportou variáveis:
unset ALERT_LOAD_TARGET
unset ALERT_CHECK_TARGET
unset ALERT_REDIS_URL
```

## 🚨 Sinais de Alerta - Quando Parar Imediatamente

Pare o teste se observar:

1. **Taxa de erro > 2%** - O sistema está falhando
2. **P95 > 1500ms** - Latência muito alta
3. **Timeout em massa (> 10%)** - Servidor sobrecarregado
4. **Erros de memória** - Vazamento ou falta de recursos
5. **Custos inesperados** - Se usar serviços pagos
6. **Alertas de provedor** - Se receber notificações de APIs externas

## 📋 Checklist de Parada Segura

- [ ] Teste interrompido (Ctrl+C ou comando equivalente)
- [ ] Processos Node.js encerrados
- [ ] Portas liberadas (5005, 6379, etc.)
- [ ] Containers Docker parados (se aplicável)
- [ ] Variáveis de ambiente temporárias removidas
- [ ] Logs salvos para análise (se necessário)
- [ ] Relatório de teste gerado (se aplicável)

## 🔍 Diagnóstico Pós-Parada

Se o backend travou ou está instável:

```bash
# Reinicie o backend:
cd backend
npm start

# Verifique logs:
tail -f logs/backend.log  # se houver log file

# Monitore recursos:
taskmgr  # Windows
htop     # Linux
Activity Monitor  # Mac
```

## 📞 Contatos de Emergência

- **Tech Lead**: [inserir contato]
- **DevOps**: [inserir contato]
- **Status Page**: [inserir URL se houver]

## 🔄 Retomada Segura

Após identificar e corrigir o problema:

1. Execute `npm run scale:check` para validar preparação
2. Execute `npm run load:cheap` com parâmetros reduzidos:
   ```bash
   ALERT_LOAD_INITIAL_CONCURRENCY=2 \
   ALERT_LOAD_MAX_CONCURRENCY=10 \
   ALERT_LOAD_REQUESTS_PER_BATCH=50 \
   npm run load:cheap
   ```
3. Monitore de perto os primeiros batches
4. Aumente gradualmente se estiver estável

## ⚠️ Avisos Importantes

- **NUNCA** execute testes de carga em produção sem aprovação explícita
- **SEMPRE** use endpoints seguros (/healthz, /) para testes
- **NUNCA** teste endpoints que geram custo (SOS real, pagamentos, etc.)
- **SEMPRE** tenha um plano de rollback antes de começar
- **DOCUMENTE** tudo para aprendizado futuro
