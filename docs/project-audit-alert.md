# 1. Resumo executivo

O Alert hoje e um sistema composto por tres blocos reais no repositorio: um app mobile React Native, um backend Node/Express e um artefato web estatico para billing. O codigo mobile esta mais avancado nas areas de Home, clima, mapas, monitoramento, guardioes, chat e SOS. O backend esta maduro o suficiente para billing Stripe, relay SOS/chat, entitlements, event hub e feed epidemico, mas ainda convive com partes parciais e inconsistencias operacionais.

Os pontos mais fortes encontrados foram:

- Mobile React Native com navegacao ampla, widgets, mapas MapLibre, clima global com cache e monitoramento multi-fonte.
- SOS com relay/store-and-forward, fila local, envio para guardioes e integracao com conversas.
- Chat de guardioes e chat privado com persistencia local, sincronizacao e realtime via Firebase/REST.
- Billing Stripe com backend dedicado, regras por mercado, checkout, portal e webhooks.
- Pipeline Android com smoke release automatizado em GitHub Actions.

Os pontos mais criticos encontrados foram:

- Autenticacao por codigo/OTP esta parcial: a tela de verificacao e mock e apenas avanca com `setTimeout`.
- Android usa `newArchEnabled=false`, entao New Architecture/Fabric/TurboModules/JSI estao preparados, mas nao ativos no runtime Android.
- Build release Android usa assinatura `debug` no `build.gradle`.
- Ha drift de hosts/config: `APP_CONFIG.API_BASE_URL` aponta para `https://alert-vmpj.onrender.com`, enquanto o `.env` local usa o host legado `https://api.alertpremium.com`, e o backend de billing trata `https://api.alert.app` como canonico.
- O servidor gRPC `EmergencyServer.ts` referencia um `emergency.proto` inexistente e nao tem dependencias gRPC declaradas no `backend/package.json`.
- Apple billing existe em codigo, mas a maturidade de produto ainda e parcial.
- Nao encontrei pipeline de crash reporting externo confirmado no codigo auditado.

Escopo da auditoria:

- Raiz auditada: `C:\Alert`
- Base principal: arquivos tracked do Git e arquivos locais de configuracao que impactam o runtime, quando presentes no worktree
- Fora do catalogo funcional principal: `artifacts/`, `android-sdk/` e `billing-web/node_modules/` como artefatos locais/ferramenta, exceto quando ajudam a classificar configuracao ou risco

# 2. Estrutura geral do repositorio

- Repositorio raiz
  - status: ativo
  - evidencia: `package.json`, `App.tsx`, `index.js`, `android/`, `ios/`, `src/`, `backend/`, `billing-web/`, `scripts/`, `docs/`
  - observacao: monorepo leve com app mobile principal, backend Node e artefato web de billing.

- App mobile React Native
  - status: ativo
  - evidencia: `App.tsx`, `index.js`, `src/`, `android/`, `ios/`
  - observacao: app cross-platform com foco em seguranca, monitoramento, chat e billing.

- Backend API
  - status: ativo
  - evidencia: `backend/index.js`, `backend/package.json`, `backend/src/**`
  - observacao: backend Express com modulos de billing, event hub, relay e bootstrap Firebase.

- Billing web hospedado como artefato
  - status: parcial
  - evidencia: `billing-web/dist/index.html`, `billing-web/dist/assets/index-4kOGczXJ.js`, `billing-web/dist/assets/index-C1YEhu43.css`
  - observacao: ha SPA compilada tracked, mas o codigo-fonte do billing web nao esta tracked no repositorio.

- Camada de widgets
  - status: ativo
  - evidencia: `src/widgets/**`, `android/app/src/main/java/com/company/alert/widgets/**`, `android/app/src/main/AndroidManifest.xml`
  - observacao: o projeto tem um subdominio bem separado para widgets, snapshots e bridge nativa Android.

- Testes
  - status: ativo
  - evidencia: `__tests__/`, `__mocks__/`, `backend/src/**/*.test.js`, `jest.config.js`, `jest.setup.js`
  - observacao: existe base de testes unitarios, mas com cobertura desigual e placeholders.

- Scripts e automacoes
  - status: ativo
  - evidencia: `scripts/android-release-smoke.ps1`, `scripts/set-github-required-smoke-check.ps1`, `scripts/react-native-bundle-ci-env.cjs`
  - observacao: foco forte em build Android, smoke release e operacao local.

- Documentacao tecnica
  - status: parcial
  - evidencia: `docs/android-native-build.md`, `docs/security/vulnerability-inventory-2026-03-26.md`, `README.md`
  - observacao: existem docs especificas, mas o `README.md` ainda e o template padrao do React Native.

- Toolchains vendorizados no repo
  - status: preparado
  - evidencia: `android/ndk/26.1.10909125/**`, `android/ndk/27.1.12297006/**`
  - observacao: o repo inclui NDKs completos, o que aumenta muito o tamanho e o ruido operacional do repositorio.

# 3. Linguagens identificadas

## Linguagens autorais e operacionais

| Linguagem | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| TypeScript | ativo | `src/**/*.ts`, `__tests__/*.ts`, `tsconfig.json` | Linguagem principal das regras de negocio, services, adapters e queries. |
| TSX | ativo | `App.tsx`, `src/screens/**/*.tsx`, `src/components/**/*.tsx` | Linguagem principal das telas e componentes React Native. |
| JavaScript | ativo | `index.js`, `babel.config.js`, `metro.config.js`, `backend/index.js` | Usado no bootstrap mobile, configs e backend Express. |
| Kotlin | ativo | `android/app/src/main/java/com/company/alert/MainApplication.kt`, `MainActivity.kt`, `widgets/*.kt` | Camada nativa Android e bridge de widgets. |
| Objective-C++ | ativo | `ios/A1/AppDelegate.mm` | Bootstrap iOS da app RN. |
| Objective-C | ativo | `ios/A1/main.m`, arquivos iOS legados | Entrada nativa iOS. |
| Ruby | ativo | `ios/Podfile`, `Gemfile` | Tooling de CocoaPods/iOS. |
| PowerShell | ativo | `scripts/*.ps1` | Automacoes de build, smoke e operacao. |
| HTML/CSS | parcial | `billing-web/dist/index.html`, `billing-web/dist/assets/index-C1YEhu43.css` | Artefato web compilado para billing. |
| Markdown | ativo | `docs/*.md`, `README.md` | Documentacao tecnica. |

## Linguagens e formatos de suporte/configuracao

| Formato | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| JSON | ativo | `package.json`, `app.json`, `react-native-firebase.json`, `backend/data/**/*.json` | Config, dados e manifests. |
| XML | ativo | `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/*.xml` | Configuracoes Android e widgets. |
| plist | ativo | `ios/A1/Info.plist`, `ios/Alert/GoogleService-Info.plist` | Config nativa iOS/Firebase. |

## Linguagens presentes apenas em toolchain vendorizado

| Linguagem | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| C/C++ | preparado | `android/ndk/**` | Presente por causa do NDK commitado; nao e linguagem principal do produto. |
| Java | preparado | `android/ndk/**` | Presente no toolchain vendorizado; nao encontrei modulo Java autoral do app. |
| Protocol Buffers | nao confirmado | `backend/src/services/EmergencyServer.ts` | O backend referencia `src/core/security/emergency.proto`, mas o arquivo nao existe no projeto. |

# 4. Frameworks, bibliotecas e SDKs

| Item | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| React Native 0.78 | ativo | `package.json`, `App.tsx`, `android/`, `ios/` | Base do app mobile. |
| React 19 | ativo | `package.json`, `App.tsx` | Runtime de UI do app. |
| Hermes | ativo | `android/gradle.properties`, `android/app/build.gradle`, `MainApplication.kt` | Hermes esta ligado no Android. |
| Fabric/TurboModules/JSI | preparado | `android/gradle.properties`, `MainActivity.kt`, `MainApplication.kt` | A estrutura existe, mas `newArchEnabled=false` desliga a New Architecture no Android. |
| React Navigation | ativo | `package.json`, `src/navigation/index.tsx` | Navegacao principal do app. |
| MapLibre React Native | ativo | `package.json`, `src/components/home/RiskMapWidget.tsx`, `src/screens/home/SecurityMapScreen.tsx` | Motor de mapas da Home e telas cheias. |
| Firebase App/Auth/Firestore/Messaging | ativo | `package.json`, `src/services/GuardianNetworkService.ts`, `src/services/ChatThreadService.ts`, `src/api/alertService.ts` | Base de auth resiliente, realtime, chat e push. |
| Firebase Remote Config | ativo | `package.json`, `src/config/remoteConfig/adsConfig.ts` | Usado para configuracao dinamica de ads. |
| Firebase Analytics | nao confirmado | `package.json` | Dependencia presente, mas nao encontrei uso direto no codigo auditado. |
| Firebase Performance | nao confirmado | `package.json` | Dependencia presente, mas nao encontrei uso direto no codigo auditado. |
| Firebase Realtime Database | nao confirmado | `package.json` | Dependencia presente, sem uso confirmado nas camadas auditadas. |
| Stripe React Native | ativo | `package.json`, `src/infrastructure/adapters/PaymentSheetAdapter.ts`, `src/screens/checkout/CheckoutScreen.tsx` | Fluxo principal de billing mobile, especialmente Android. |
| react-native-iap | parcial | `package.json`, `src/billing/AppleBillingClient.ts`, `src/billing/BillingProvider.ts` | Cliente Apple existe, mas a maturidade de produto iOS ainda e parcial. |
| Google Mobile Ads | parcial | `package.json`, `src/ads/AdsBootstrap.ts`, `src/ads/GoogleMobileAdsRuntime.ts`, `react-native.config.js` | SDK preparado com consent e remote config, mas default de ads esta desligado e ha desvio de autolinking no Android. |
| AsyncStorage | ativo | `src/services/WeatherService.ts`, `NotificationService.ts`, `EntitlementService.ts`, `RouteDestinationService.ts` | Principal camada de persistencia local geral. |
| MMKV | ativo | `src/services/chat/ChatPersistenceService.ts` | Usado no cache/persistencia criptografada de chat com fallback para AsyncStorage. |
| Reanimated/Gesture Handler/Safe Area/Screens | ativo | `package.json`, `App.tsx`, `index.js` | Base de UX e navegacao. |
| Lottie | parcial | `package.json`, `src/assets/weather/lottie/*.json` | Existe suporte, mas varios assets auditados sao placeholders minimos. |
| WebView | ativo | `package.json`, `src/screens/WebViewScreen.tsx` | Usado para superficies web integradas. |
| Express | ativo | `backend/package.json`, `backend/index.js` | Framework do backend. |
| Firebase Admin | ativo | `backend/package.json`, `backend/index.js`, `backend/src/bootstrap/firebaseAdmin.js` | Base do backend para Firestore/FCM e billing persistence. |
| Stripe backend SDK | ativo | `backend/package.json`, `backend/src/billing/*.js` | Checkout, portal, webhooks e reconciliacao. |
| gRPC server stack | parcial | `backend/src/services/EmergencyServer.ts` | Codigo existe, mas faltam dependencias gRPC no `backend/package.json` e o proto esperado nao existe. |
| react-native-config | nao confirmado | `package.json` | Dependencia presente, sem uso confirmado no codigo auditado. |
| react-native-facebook | nao confirmado | `package.json` | Dependencia presente, sem uso funcional confirmado no app. |

# 5. Arquitetura identificada

- Shell mobile por providers/context
  - status: ativo
  - evidencia: `App.tsx`, `src/context/ThemeContext.tsx`, `src/context/SecurityContext.tsx`
  - observacao: a app sobe com providers centrais para tema, seguranca, safe area e gesture handler.

- Navegacao por stack e deep link
  - status: ativo
  - evidencia: `src/navigation/index.tsx`
  - observacao: ha deep linking, persistencia de estado de navegacao e resolucao de push/deeplink na entrada.

- Mistura de arquitetura em camadas com services orientados a feature
  - status: parcial
  - evidencia: `src/application/**`, `src/domain/**`, `src/infrastructure/**`, `src/services/**`
  - observacao: ha bolsos claros de Clean Architecture/CQRS, mas boa parte do app ainda depende de services amplos e telas fortes.

- CQRS/light read models
  - status: ativo
  - evidencia: `src/application/queries/GetOperationalSnapshotQuery.ts`, `GetAlertBrainBriefingQuery.ts`, `GetAlertAssistantReplyQuery.ts`, `src/widgets/application/commands/**`
  - observacao: queries e commands existem, principalmente em monitoramento, assistant e widgets.

- Widget module mais coerente arquiteturalmente
  - status: ativo
  - evidencia: `src/widgets/domain/**`, `src/widgets/application/**`, `src/widgets/infra/**`, `src/widgets/presentation/**`
  - observacao: o modulo de widgets e o melhor exemplo de separacao por camadas no projeto.

- Backend como monolito modular
  - status: ativo
  - evidencia: `backend/index.js`, `backend/src/billing/**`, `backend/src/eventHub/**`, `backend/src/bootstrap/**`
  - observacao: billing, event hub e bootstrap estao separados em modulos, mas servidos por uma unica app Express.

- Fallbacks e modos degradados
  - status: ativo
  - evidencia: `backend/src/bootstrap/firebaseAdmin.js`, `src/infrastructure/adapters/OperationalSnapshotApiAdapter.ts`, `src/services/KyberNetworkService.ts`, `src/services/chat/ChatPersistenceService.ts`
  - observacao: ha varios fallbacks locais e degradados, especialmente para backend/Firebase indisponivel, relay offline e caches locais.

# 6. Frontend mobile

| Area | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Shell e bootstrap da app | ativo | `index.js`, `App.tsx` | Sobe com polyfills, BootError fallback, providers e tarefas diferidas apos Home. |
| Navegacao | ativo | `src/navigation/index.tsx` | Stack extensa com push/deeplink e restore de estado. |
| Home principal | ativo | `HomeScreen.tsx`, `FastHomeScreen.tsx` | Surface principal com clima, mapa, SOS, mensagens e atalhos. |
| Clima na Home | ativo | `WeatherWidget.tsx`, `WeatherService.ts` | Widget rico com cache e integracao global de clima. |
| Mapa/risk widget | ativo | `RiskMapWidget.tsx`, `MapStyles.ts` | Widget MapLibre na Home com alternancia de estilo. |
| Mapa de seguranca full-screen | ativo | `SecurityMapScreen.tsx`, `SecurityMapView.tsx` | Tela completa de incidentes, overlays e captura. |
| Feed e monitoramento | ativo | `MonitoringFeedScreen.tsx`, `RealtimeInsightsScreen.tsx`, `MonitoringScreen.tsx` | Dominio central de monitoramento geoespacial, eventos e sinais. |
| Conversas e chat | ativo | `ConversationsScreen.tsx`, `ChatThreadScreen.tsx`, `PrivateReplyScreen.tsx` | Inbox, chat em grupo, resposta privada e sincronizacao. |
| Guardioes | ativo | `GuardiansScreen.tsx`, `GuardiansGroupChatScreen.tsx` | Cadastro, grupo fixado, localizacoes e dialogo com guardioes. |
| Perfil e configuracoes | ativo | `ProfileScreen.tsx`, `SettingScreen.tsx`, `src/screens/settings/**` | Tema, idioma, perfil, suporte e configuracoes diversas. |
| Checkout/premium | ativo | `src/screens/checkout/CheckoutScreen.tsx` | Surface de premium, portal e pagamento. |
| Alert Assistant | parcial | `AlertAssistantScreen.tsx`, `GetAlertAssistantReplyQuery.ts`, `src/i18n/index.ts` | Assistente funcional com respostas estruturadas, mas sem recursos multimodais prometidos. |
| Widgets | ativo | `WidgetCatalogScreen.tsx` | Catalogo e snapshots para widgets. |
| Auth/onboarding | parcial | `LoginScreen.tsx`, `VerifyCodeScreen.tsx`, `ProfileSetupScreen.tsx`, `SetupContactsScreen.tsx` | Fluxo visual existe, mas a verificacao por codigo e simulada. |

# 7. Backend e servicos

| Modulo | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| API Express principal | ativo | `backend/index.js`, `backend/package.json` | Backend monolitico com billing, relay, event hub e APIs operacionais. |
| Bootstrap Firebase Admin | ativo | `backend/src/bootstrap/firebaseAdmin.js` | Inicializacao com modo degradado quando falta service account. |
| Billing Stripe | ativo | `backend/src/billing/registerStripeBilling.js`, `registerStripeCheckoutRoutes.js`, `billingConfig.js` | Checkout, portal, webhooks e reconciliacao por mercado. |
| Billing Apple | parcial | `backend/src/billing/registerAppleBilling.js`, `appleBillingService.js`, `registerAppStoreNotifications.js` | Rotas e servicos existem, mas a maturidade do fluxo iOS ainda e desigual. |
| Event Hub | ativo | `backend/src/eventHub/EventHubService.js`, `providerRegistry.js`, adapters | Agregacao de eventos por provider, bbox e tipo. |
| Feed epidemico | ativo | `backend/src/services/EpidemicFeedService.js`, `backend/data/epidemic/registry.json` | Feed dedicado por pais/regiao. |
| Relay SOS/chat | ativo | `backend/index.js`, `src/services/AlertRelayService.ts` | Token de relay, push/pull SOS e chat com HMAC/TTL. |
| Entitlements | ativo | `backend/index.js`, `src/services/EntitlementService.ts` | API de premium/flags para o app. |
| gRPC emergency server | parcial | `backend/src/services/EmergencyServer.ts` | Arquivo existe, mas esta quebrado por depender de proto inexistente e deps ausentes. |
| Billing web estatico servido pelo backend | ativo | `backend/index.js`, `billing-web/dist/index.html` | O backend hospeda a SPA compilada de billing. |

# 8. APIs internas e externas

## APIs internas do projeto

| API/rota | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| `/api/me/entitlements` | ativo | `backend/index.js`, `src/services/EntitlementService.ts` | Fonte de premium/feature flags. |
| `/api/register-token` | ativo | `backend/index.js`, `src/services/GuardianNetworkService.ts` | Registro de token/presenca de device. |
| `/api/guardian/request` | ativo | `backend/index.js`, `src/services/GuardianNetworkService.ts` | Convite/solicitacao entre guardioes. |
| `/api/sos` | ativo | `backend/index.js`, `src/services/GuardianNetworkService.ts`, `SosDispatchService.ts` | Disparo SOS para guardioes. |
| `/api/checkin` | ativo | `backend/index.js`, `src/services/GuardianNetworkService.ts` | Fluxo de check-in. |
| `/api/chat/conversations` | ativo | `backend/index.js`, `src/services/chat/ChatSyncService.ts` | Sync de conversas. |
| `/api/chat/messages` | ativo | `backend/index.js`, `src/services/chat/ChatSyncService.ts` | Sync de mensagens. |
| `/api/chat/send` e `/api/chat/ack` | ativo | `backend/index.js`, `src/services/chat/ChatSyncService.ts` | Envio/ack de chat. |
| `/api/relay/token` e `/api/relay/ping` | ativo | `backend/index.js`, `src/services/AlertRelayService.ts`, `StarlinkConnectService.ts` | Tokenizacao e health do relay. |
| `/api/relay/sos` | ativo | `backend/index.js`, `src/services/AlertRelayService.ts`, `KyberNetworkService.ts` | Relay de SOS com fila local. |
| `/api/relay/chat/send` e `/api/relay/chat/messages` | ativo | `backend/index.js`, `src/services/AlertRelayService.ts` | Chat via canal relay. |
| `/v1/events` | ativo | `backend/index.js`, `src/services/EventHubService.ts` | Feed principal de eventos operacionais. |
| `/v1/health/top` | ativo | `backend/index.js`, `src/services/EventHubService.ts` | Destaques de saude/epidemia. |
| `/v1/operational/snapshot` | ativo | `backend/index.js`, `src/infrastructure/adapters/OperationalSnapshotApiAdapter.ts` | Snapshot consolidado operacional. |
| `/v1/providers/status` | ativo | `backend/index.js` | Status dos providers do event hub. |
| `/v1/epidemic/feed` | ativo | `backend/index.js`, `src/services/EpidemicService.ts` | Feed epidemico. |
| `/v1/meta/countries` | ativo | `backend/index.js`, `backend/data/iso3166/countries.json` | Metadados de paises. |
| `/config/official-sources-registry` | parcial | `src/services/OfficialSourcesRegistryService.ts` | Consumida no mobile, mas nao encontrei rota correspondente no backend auditado. |
| Billing endpoints (`/billing/auth-token`, `/create-checkout-session`, `/create-payment-intent`, `/create-portal-session`, `/webhook`, `/webhooks/stripe`, `/sync-apple-purchase`, `/restore-apple-purchases`, `/apple-entitlement/:userId`, `/app-store-notifications`) | ativo/parcial | `backend/index.js`, `backend/src/billing/**` | Stripe esta mais madura; Apple esta parcialmente integrada. |

## APIs externas e integracoes de terceiros

| Integracao | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Firebase Auth | ativo | `src/services/FirebaseAuthResilienceService.ts`, `GuardianNetworkService.ts`, `ChatThreadService.ts` | Auth anonima resiliente e identidade Firebase para realtime. |
| Firestore | ativo | `src/services/GuardianNetworkService.ts`, `ChatThreadService.ts`, `backend/src/bootstrap/firebaseAdmin.js` | Base de guardian requests, chats, SOS e check-ins. |
| Firebase Cloud Messaging | ativo | `index.js`, `src/api/alertService.ts`, `src/services/PushNotificationService.ts` | Push foreground/background e deep links por notificacao. |
| Stripe | ativo | `src/infrastructure/adapters/PremiumBillingApiAdapter.ts`, `backend/src/billing/**` | Billing principal no Android/backend. |
| Apple App Store / StoreKit | parcial | `src/billing/AppleBillingClient.ts`, `backend/src/billing/registerAppleBilling.js` | Suporte presente, maturidade parcial. |
| Open-Meteo | ativo | `src/services/WeatherService.ts`, `backend/src/eventHub/adapters/meteoAdapter.js` | Clima atual, previsao e nowcast. |
| Nominatim | ativo | `src/services/WeatherService.ts`, `src/services/ReverseGeocodeService.ts` | Reverse geocoding para cidade/local. |
| NOAA | ativo | `src/services/WeatherService.ts`, `NotificationService.ts` | Alertas/feeds meteorologicos e marinhos. |
| USGS | ativo | `src/services/WeatherService.ts`, `backend/src/eventHub/providerRegistry.js` | Eventos geofisicos. |
| GDACS | ativo | `src/services/WeatherService.ts`, `backend/src/eventHub/providerRegistry.js` | Eventos hidrologicos/desastres. |
| WHO/saude global | ativo | `backend/src/eventHub/providerRegistry.js`, `src/services/EpidemicService.ts` | Dominio epidemico/saude. |
| Google Mobile Ads / UMP | parcial | `src/ads/AdsBootstrap.ts`, `ConsentManager.ts`, `GoogleMobileAdsRuntime.ts` | Infra existe, mas rollout e uso estao controlados e parcialmente desligados. |
| Map provider configuravel / MapTiler | parcial | `src/core/config.ts`, `src/constants/MapStyles.ts` | Flags de estilo e chave existem; provider final depende de runtime config. |
| Render | citado | `src/core/config.ts`, `index.js`, `backend/src/billing/billingConfig.js` | URLs `onrender.com` aparecem no codigo, mas nao ha configuracao de deploy Render tracked. |

# 9. Funcionalidades do app por dominio

| Nome | Dominio | Status | Onde esta implementada | Evidencia | Integracoes/dependencias | Observacao sobre maturidade |
| --- | --- | --- | --- | --- | --- | --- |
| Onboarding inicial | onboarding | ativo | `src/screens/auth/WelcomeScreen.tsx`, `LoginScreen.tsx` | `src/screens/auth/*.tsx` | React Navigation, i18n | Fluxo visual pronto. |
| Verificacao por codigo | autenticacao | parcial | `src/screens/auth/VerifyCodeScreen.tsx` | `VerifyCodeScreen.tsx` | UI local apenas | A verificacao e mock: nao ha provedor OTP real confirmado. |
| Setup de perfil | conta/perfil | ativo | `ProfileSetupScreen.tsx`, `ProfileScreen.tsx`, `ProfileService.ts` | `src/screens/auth/ProfileSetupScreen.tsx`, `src/screens/ProfileScreen.tsx` | AsyncStorage, image picker, camera | Cadastro de nome/avatar local. |
| Setup de contatos/convites | onboarding/guardioes | ativo | `SetupContactsScreen.tsx` | `src/screens/auth/SetupContactsScreen.tsx` | Contacts, Share, permissions | Importa contatos e permite convidar. |
| Home principal | home | ativo | `HomeScreen.tsx`, `FastHomeScreen.tsx` | `src/screens/home/HomeScreen.tsx` | WeatherWidget, RiskMapWidget, SOS, mensagens | Superficie principal do produto. |
| Barra/clima atual | clima | ativo | `WeatherWidget.tsx`, `WeatherService.ts` | `src/components/home/WeatherWidget.tsx`, `src/services/WeatherService.ts` | Open-Meteo, Nominatim, cache | Funcionalidade robusta com cache, alertas e fallback. |
| Mapa da Home | mapa | ativo | `RiskMapWidget.tsx` | `src/components/home/RiskMapWidget.tsx` | MapLibre, estilos de mapa | Widget compacto com alternancia de estilo. |
| Mapa de seguranca | mapa/risco | ativo | `SecurityMapScreen.tsx`, `SecurityMapView.tsx` | `src/screens/home/SecurityMapScreen.tsx`, `src/components/map/SecurityMapView.tsx` | MapLibre, UnifiedIncidentStore | Surface rica de incidentes e overlays. |
| Feed de monitoramento | monitoramento | ativo | `MonitoringFeedScreen.tsx`, `MonitoringScreen.tsx`, `RealtimeInsightsScreen.tsx` | `src/screens/home/MonitoringFeedScreen.tsx`, `RealtimeInsightsScreen.tsx` | EventHub, EpidemicService, intelligence | Um dos dominios mais fortes do produto. |
| Fontes oficiais | monitoramento | ativo | `OfficialSourcesScreen.tsx`, `OfficialSourcesResolver.ts` | `src/screens/home/OfficialSourcesScreen.tsx`, `src/services/OfficialSourcesResolver.ts` | Registry local/remoto | Resolver de fontes ativo; remote registry parcial. |
| Mapa epidemico | monitoramento/saude | ativo | `EpidemicMapScreen.tsx`, `EpidemicService.ts` | `src/screens/home/EpidemicMapScreen.tsx`, `src/services/EpidemicService.ts` | Backend `/v1/epidemic/feed` | Dominio de saude/epidemias implementado. |
| SOS in-app | SOS | ativo | `HomeScreen.tsx`, `SecurityContext.tsx`, `SosDispatchService.ts` | `src/services/SosDispatchService.ts`, `src/context/SecurityContext.tsx` | Kyber relay, guardians, chat, risk report | Fluxo central ativo com redundancia e fila local. |
| SOS headless/quick action | SOS | ativo | `index.js`, `src/tasks/SOSQuickTask.ts` | `index.js`, `src/tasks/SOSQuickTask.ts` | Headless task, SosDispatchService | Quick action/background registrado. |
| Grupo de guardioes fixado | guardioes/mensageria | ativo | `ConversationsScreen.tsx`, `guardiansConversation.ts`, `GuardiansGroupChatScreen.tsx` | `src/screens/home/ConversationsScreen.tsx`, `src/services/chat/guardiansConversation.ts`, `src/screens/home/GuardiansGroupChatScreen.tsx` | Firestore, chat persistence, MapLibre | Grupo dos guardioes esta implementado e priorizado na caixa de mensagens. |
| Chat privado com guardiao | mensageria | ativo | `PrivateReplyScreen.tsx`, `ChatThreadScreen.tsx` | `src/screens/chat/PrivateReplyScreen.tsx`, `src/screens/chat/ChatThreadScreen.tsx` | Firestore, backend chat sync | Dialogo privado existe para usuarios/guardioes. |
| Gestao de guardioes | guardioes | ativo | `GuardiansScreen.tsx`, `GuardianNetworkService.ts` | `src/screens/home/GuardiansScreen.tsx`, `src/services/GuardianNetworkService.ts` | Firebase, backend REST fallback | Permite adicionar/remover e convidar guardioes. |
| Check-in | seguranca | ativo | `CheckInScreen.tsx`, `GuardianNetworkService.ts` | `src/screens/CheckInScreen.tsx`, `src/services/GuardianNetworkService.ts` | Backend `/api/checkin`, notifications | Fluxo existe, embora notificacoes automaticas de check-in estejam desativadas por decisao de produto. |
| Central de notificacoes | notificacoes | ativo | `NotificationsScreen.tsx`, `NotificationService.ts` | `src/screens/home/NotificationsScreen.tsx`, `src/services/NotificationService.ts` | AsyncStorage, push parsing | Centro local de notificacoes com unread e active SOS. |
| Planejamento de rota | mapa/localizacao | ativo | `RouteSettingsScreen.tsx`, `RouteService.ts`, `OfflineCacheService.ts` | `src/screens/home/RouteSettingsScreen.tsx`, `src/services/maps/OfflineCacheService.ts` | MapLibre, cache local | Planejamento e cache offline de rota/locais. |
| Widgets | widgets | ativo | `WidgetCatalogScreen.tsx`, `RefreshWidgetSnapshotsCommand.ts` | `src/widgets/**`, `android/.../widgets/**` | Widget bridge Android, snapshots | Dominio bem estruturado e conectado. |
| Premium / checkout / portal | planos/premium | ativo/parcial | `CheckoutScreen.tsx`, `PremiumBillingApiAdapter.ts`, backend billing | `src/screens/checkout/CheckoutScreen.tsx`, `backend/src/billing/**` | Stripe, entitlements, billing web | Forte no Android/Stripe; Apple ainda parcial. |
| Alert Assistant | assistente | parcial | `AlertAssistantScreen.tsx`, `GetAlertAssistantReplyQuery.ts` | `src/screens/home/AlertAssistantScreen.tsx`, `src/application/queries/GetAlertAssistantReplyQuery.ts` | Snapshot operacional, alert intelligence, i18n | Funciona com respostas estruturadas, mas sem multimodal prometido. |
| Suporte | suporte | ativo | `SupportScreen.tsx` | `src/screens/settings/SupportScreen.tsx` | i18n, ThemeContext | Tela de suporte implementada. |
| Temas e idioma | configuracoes | ativo | `ThemeContext.tsx`, `LanguageSelectorScreen.tsx`, `LocaleService.ts` | `src/context/ThemeContext.tsx`, `src/screens/settings/LanguageSelectorScreen.tsx`, `src/services/LocaleService.ts` | AsyncStorage, i18n | Tema claro/escuro/sistema e idioma persistido. |
| Ads in-app | monetizacao | parcial | `AdsBootstrap.ts`, `AdSlot.tsx`, `ConsentManager.ts` | `src/ads/**`, `src/config/remoteConfig/adsConfig.ts` | Google Mobile Ads, Remote Config | Preparado com gating e consent, mas nao parece plenamente ligado em producao. |

# 10. Funcionalidades tecnicas internas

| Capacidade interna | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Boot error fallback | ativo | `index.js`, `src/components/boot/BootErrorScreen.tsx` | A app renderiza uma tela de erro de bootstrap se a inicializacao falhar. |
| Deep links | ativo | `src/navigation/index.tsx`, `index.js` | Schemes `alertapp://` e rotas mapeadas. |
| Persistencia de estado da navegacao | ativo | `src/navigation/index.tsx` | Restore de estado com AsyncStorage. |
| Fila local de SOS/relay | ativo | `src/services/KyberNetworkService.ts` | Store-and-forward com retry e flush. |
| Persistencia de chat com criptografia local | ativo | `src/services/chat/ChatPersistenceService.ts` | MMKV com chave derivada do device e fallback AsyncStorage. |
| Cost guard | ativo | `src/services/cost/CostGuard.ts`, `src/application/cost/BudgetGuard.ts` | Politica de custo e avaliacao por feature/provider/tier. |
| Operational snapshot cache | ativo | `src/infrastructure/adapters/OperationalSnapshotApiAdapter.ts` | Cache memoria + AsyncStorage com fail-soft. |
| Monitoring continuity store | ativo | `src/services/MonitoringContinuityStore.ts` | Persistencia de continuidade e fallback de sinais. |
| Widget snapshot pipeline | ativo | `src/widgets/application/commands/RefreshWidgetSnapshotsCommand.ts`, `src/widgets/infra/WidgetBridge.ts` | Gera snapshots e atualiza widgets nativos. |
| Ads remote config gating | ativo | `src/config/remoteConfig/adsConfig.ts`, `src/ads/AdsBootstrap.ts` | Feature flags de ads por remote config. |
| Telemetria local e redacao | ativo | `src/services/TelemetryService.ts`, `src/privacy/RedactionLogger.ts` | Buffer local com sanitizacao de PII. |
| Integridade de dispositivo | ativo | `src/core/security/IntegrityCheck.ts` | Bloqueio basico para emulator/root/jailbreak, com lacunas. |

# 11. Autenticacao, autorizacao e seguranca

- Onboarding por telefone
  - status: parcial
  - evidencia: `src/screens/auth/LoginScreen.tsx`, `src/screens/auth/VerifyCodeScreen.tsx`
  - observacao: o telefone e coletado e persistido, mas a verificacao por codigo nao usa provedor real; apenas espera 1 segundo e navega.

- Firebase auth anonima resiliente
  - status: preparado
  - evidencia: `src/services/FirebaseAuthResilienceService.ts`, `src/core/config.ts`
  - observacao: existe estrategia com backoff e bloqueios, mas depende de `AUTH_ANONYMOUS_ENABLED`, que por padrao esta `false`.

- Autorizacao/premium por entitlements
  - status: ativo
  - evidencia: `src/services/EntitlementService.ts`, `backend/index.js`
  - observacao: feature flags e plano premium sao resolvidos via backend, com cache local e fallback.

- Device integrity check
  - status: ativo
  - evidencia: `src/core/security/IntegrityCheck.ts`, `App.tsx`
  - observacao: a app checa emulator/root/jailbreak no startup, mas o tratamento e fail-open em erros da biblioteca.

- Redacao de PII em logs
  - status: ativo
  - evidencia: `src/privacy/RedactionLogger.ts`
  - observacao: remove ou mascara coordenadas, emails, telefones, tokens, uids e device ids.

- Protecoes nativas Android
  - status: ativo
  - evidencia: `android/app/src/main/AndroidManifest.xml`
  - observacao: `android:allowBackup="false"` e esquema deep link restrito estao presentes.

- Protecoes nativas iOS
  - status: parcial
  - evidencia: `ios/A1/Info.plist`
  - observacao: ATS restringe cargas arbitrarias, mas `NSLocationWhenInUseUsageDescription` esta vazio, o que e risco de UX/App Review.

- Flags de seguranca declarativas
  - status: citado
  - evidencia: `src/core/config.ts`
  - observacao: `SSL_PINNING`, `BIOMETRIC_AUTH`, `ENCRYPTED_STORAGE`, `JWT_REFRESH` e `RATE_LIMITING` aparecem como flags, mas nao encontrei implementacao efetiva correspondente para todas elas no codigo auditado.

- Segredos e configs sensiveis no worktree local
  - status: parcial
  - evidencia: `.env` local, `backend/src/bootstrap/firebaseAdmin.js`, `ios/Alert/GoogleService-Info.plist`
  - observacao: o repositorio tracked inclui `GoogleService-Info.plist`; alem disso, o backend aceita um `backend/firebase-admin.json` local, e existe `.env` local no worktree. Isso exige governanca forte fora desta auditoria.

# 12. Armazenamento, estado e persistencia

| Camada | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| AsyncStorage | ativo | `src/services/WeatherService.ts`, `NotificationService.ts`, `EntitlementService.ts`, `OfficialSourcesRegistryService.ts`, `RouteDestinationService.ts` | Principal storage local do app. |
| MMKV | ativo | `src/services/chat/ChatPersistenceService.ts` | Persistencia sincronizada e criptografada para chat, com fallback AsyncStorage. |
| Firestore | ativo | `src/services/GuardianNetworkService.ts`, `src/services/ChatThreadService.ts` | Store remota de chats, requests, SOS e check-ins. |
| Cache em memoria | ativo | `src/services/EventHubService.ts`, `OperationalSnapshotApiAdapter.ts` | Usado para snapshots, feed e reducao de refetch. |
| Estado por React Context | ativo | `src/context/ThemeContext.tsx`, `src/context/SecurityContext.tsx` | Estado transversal de UI e localizacao/seguranca. |
| Estado local por tela | ativo | `src/screens/**/*.tsx` | O app usa bastante `useState`, `useMemo`, `useEffect` nas telas. |
| Banco local estruturado (SQLite/Realm) | nao confirmado | ausencia de dependencias/uso | Nao encontrei SQLite, Realm ou equivalente. |
| Redux/Zustand/MobX | nao confirmado | ausencia de dependencias/uso | Nao encontrei state manager global desse tipo. |

# 13. Mapas, clima, geolocalizacao e risco

- MapLibre como motor de mapa
  - status: ativo
  - evidencia: `src/components/home/RiskMapWidget.tsx`, `src/screens/home/SecurityMapScreen.tsx`, `src/screens/home/RouteSettingsScreen.tsx`
  - observacao: presente na Home, rotas, monitoramento, chat de guardioes e mapa de seguranca.

- Config de estilos e satelite
  - status: ativo
  - evidencia: `src/constants/MapStyles.ts`, `src/core/config.ts`
  - observacao: estilos default/satelite sao configuraveis por runtime globals.

- Localizacao atual e ultimo snapshot
  - status: ativo
  - evidencia: `src/context/SecurityContext.tsx`, `src/utils/locationAccess.ts`, `src/utils/locationQuality.ts`
  - observacao: a camada de seguranca persiste ultima localizacao/cidade e trabalha com qualidade de sinal.

- Clima atual e previsao
  - status: ativo
  - evidencia: `src/services/WeatherService.ts`, `src/components/home/WeatherWidget.tsx`
  - observacao: o servico trata cache, sanidade, forecast, feels like e alertas.

- Risk/incident aggregation
  - status: ativo
  - evidencia: `src/services/data/UnifiedIncidentStore.ts`, `src/screens/home/SecurityMapScreen.tsx`
  - observacao: consolida sinais operacionais, crowd reports e continuidade.

- Event hub operacional
  - status: ativo
  - evidencia: `src/services/EventHubService.ts`, `backend/src/eventHub/**`, `backend/index.js`
  - observacao: fornece feed unificado de eventos para monitoramento.

- Snapshot operacional consolidado
  - status: ativo
  - evidencia: `src/infrastructure/adapters/OperationalSnapshotApiAdapter.ts`, `src/application/queries/GetOperationalSnapshotQuery.ts`
  - observacao: read model com tratamento de fresco/stale/erro.

- Registry de fontes oficiais
  - status: ativo/parcial
  - evidencia: `src/services/OfficialSourcesRegistryService.ts`, `src/data/officialSourcesRegistry.json`
  - observacao: o fallback local esta ativo; o fetch remoto esta preparado, mas a rota correspondente nao foi confirmada no backend auditado.

- Rotas e cache offline
  - status: ativo
  - evidencia: `src/services/maps/OfflineCacheService.ts`, `src/services/RouteService.ts`, `RouteSettingsScreen.tsx`
  - observacao: o app guarda destinos, viewport, rotas e favoritos em cache local.

- Risk reports locais
  - status: ativo
  - evidencia: `src/services/RiskReportService.ts`
  - observacao: storage local de reports/ativacoes para mapas e calor operacional.

# 14. Billing, pagamentos e assinaturas

| Item | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Billing Stripe mobile/backend | ativo | `src/infrastructure/adapters/PremiumBillingApiAdapter.ts`, `src/screens/checkout/CheckoutScreen.tsx`, `backend/src/billing/**` | Principal stack de assinatura/pagamento confirmada. |
| Entitlements premium | ativo | `src/services/EntitlementService.ts`, `backend/index.js` | Feature flags e plano premium servidos pelo backend. |
| Hosted billing web | parcial | `billing-web/dist/**`, `backend/index.js` | A SPA compilada existe e e servida, mas o codigo-fonte web nao esta tracked. |
| Mercado/precos por pais/moeda/tier | ativo | `backend/src/billing/billingConfig.js`, `priorityMarkets.js` | Regras por mercado e canonicalizacao de host. |
| Portal do cliente | ativo | `backend/src/billing/registerStripeCheckoutRoutes.js`, `CheckoutScreen.tsx` | Ha criacao de portal session. |
| Payment Sheet adapter | ativo | `src/infrastructure/adapters/PaymentSheetAdapter.ts` | Integracao Stripe React Native. |
| Apple billing client | parcial | `src/billing/AppleBillingClient.ts`, `src/billing/BillingProvider.ts`, `backend/src/billing/registerAppleBilling.js` | Implementacao existe, mas o produto ainda nao parece fechado para App Store como principal caminho. |
| Webhooks Stripe | ativo | `backend/index.js`, `backend/src/billing/registerStripeBilling.js` | Backend trata webhook e sincronizacao. |
| App Store notifications | parcial | `backend/src/billing/registerAppStoreNotifications.js` | Rota existe, mas maturidade de ponta a ponta ainda e parcial. |

# 15. Analytics, logs, monitoramento e crash reporting

- Telemetria local de eventos
  - status: ativo
  - evidencia: `src/services/TelemetryService.ts`
  - observacao: buffer local com sessao, sampling e envio potencial futuro.

- Redaction logger
  - status: ativo
  - evidencia: `src/privacy/RedactionLogger.ts`
  - observacao: logger de seguranca sem PII crua.

- Eventos de ads
  - status: ativo
  - evidencia: `src/analytics/adEvents.ts`
  - observacao: camada pequena de telemetria para ads.

- Firebase Analytics
  - status: nao confirmado
  - evidencia: `package.json`
  - observacao: dependencia presente, mas sem uso runtime confirmado na auditoria.

- Firebase Performance
  - status: nao confirmado
  - evidencia: `package.json`
  - observacao: dependencia presente, mas sem uso runtime confirmado na auditoria.

- Sentry/Crashlytics/equivalente
  - status: nao confirmado
  - evidencia: ausencia de referencias em `src/`, `backend/`, `ios/`, `android/`
  - observacao: nao encontrei pipeline de crash reporting externo claramente ligado.

- Observabilidade de build Android
  - status: ativo
  - evidencia: `.github/workflows/android-release-smoke.yml`, `scripts/android-release-smoke.ps1`
  - observacao: existe smoke real com artefatos e resumo publicado no workflow.

# 16. Push notifications e mensageria

- Firebase Cloud Messaging
  - status: ativo
  - evidencia: `index.js`, `src/api/alertService.ts`, `src/services/PushNotificationService.ts`
  - observacao: handlers foreground/background e navegacao por notificacao estao implementados.

- Centro local de notificacoes
  - status: ativo
  - evidencia: `src/services/NotificationService.ts`, `src/screens/home/NotificationsScreen.tsx`
  - observacao: inbox local com unread, active SOS e dedupe.

- Mensageria com guardioes e chat sync
  - status: ativo
  - evidencia: `src/services/ChatThreadService.ts`, `src/services/chat/ChatSyncService.ts`, `ConversationsScreen.tsx`, `GuardiansGroupChatScreen.tsx`, `PrivateReplyScreen.tsx`
  - observacao: ha inbox, grupo fixado, conversa privada e persistencia/offline.

- SOS como mensagem no grupo dos guardioes
  - status: ativo
  - evidencia: `src/services/SosDispatchService.ts`, `src/services/GuardianNetworkService.ts`
  - observacao: o SOS escreve no fluxo dos guardioes alem do relay.

- Check-in notifications automaticas
  - status: parcial
  - evidencia: `src/services/NotificationService.ts`, `PushNotificationService.ts`
  - observacao: a infraestrutura existe, mas o produto desativou a exibicao automatica de check-in em varios caminhos.

- SMS
  - status: citado
  - evidencia: `package.json`, `src/i18n/index.ts`, `src/utils/permissions.ts`
  - observacao: ha dependencia e copy relacionadas a SMS, mas nao encontrei uso runtime confirmado do envio SMS na trilha auditada.

# 17. Internacionalizacao e acessibilidade

- Internacionalizacao pt-BR/en
  - status: ativo
  - evidencia: `src/i18n/index.ts`, `src/services/LocaleService.ts`, `src/i18n/bootstrap.ts`
  - observacao: ha pelo menos portugues e ingles, com persistencia do idioma.

- Modo idioma do sistema
  - status: ativo
  - evidencia: `src/services/LocaleService.ts`, `src/constants/locales.ts`
  - observacao: o app consegue seguir o idioma do device ou uma escolha manual.

- Font scaling/Dynamic Type
  - status: ativo
  - evidencia: `App.tsx`, `ThemeTokens.ts`
  - observacao: `Text` e `TextInput` recebem max multiplier padrao, e varias telas usam `allowFontScaling`.

- Safe area e navegacao acessivel
  - status: ativo
  - evidencia: `App.tsx`, `src/screens/**/*.tsx`
  - observacao: o projeto usa `SafeAreaProvider`, `SafeAreaView` e muitos `accessibilityLabel/hint`.

- Areas com hardcode residual
  - status: parcial
  - evidencia: `src/screens/auth/VerifyCodeScreen.tsx`, `src/core/security/IntegrityCheck.ts`
  - observacao: ainda existem strings e copy hardcoded fora de i18n em alguns pontos.

- A11y de ponta a ponta
  - status: nao confirmado
  - evidencia: ausencia de testes dedicados e validacao runtime especifica
  - observacao: existe esforco estrutural, mas nao encontrei suite ou checklist de a11y fim a fim.

# 18. Build, release, deploy e ambiente

| Area | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Android build com Gradle/Kotlin | ativo | `android/app/build.gradle`, `android/gradle.properties` | Build principal Android com Hermes e flags de bundle debug/release. |
| iOS build com CocoaPods | ativo | `ios/Podfile`, `ios/A1/AppDelegate.mm` | Build iOS padrao RN. |
| Metro/Babel/TypeScript/Jest | ativo | `metro.config.js`, `babel.config.js`, `tsconfig.json`, `jest.config.js` | Toolchain JS principal do app. |
| ESLint/Prettier | parcial | `.eslintrc.js`, `.prettierrc.js`, `eslint.config.js` | ESLint classico existe, mas `eslint.config.js` esta vazio. |
| Android release smoke CI | ativo | `.github/workflows/android-release-smoke.yml`, `scripts/android-release-smoke.ps1` | Pipeline mais robusto do projeto hoje. |
| Release signing Android | parcial | `android/app/build.gradle`, `release.keystore` | O release esta apontando para assinatura debug, o que e risco alto para distribuicao real. |
| New Architecture | preparado | `android/gradle.properties`, `MainActivity.kt`, `MainApplication.kt` | Estrutura existe, mas nao esta ligada no Android atual. |
| Hermes | ativo | `android/gradle.properties`, `android/app/build.gradle` | Engine JS ativa. |
| Deploy backend | parcial | `backend/index.js`, URLs `onrender.com` em `APP_CONFIG`/billing tests | O backend esta operacional no codigo, mas nao ha infraestrutura/deploy config tracked. |
| Deploy web billing | parcial | `billing-web/dist/**`, `backend/index.js` | O artefato e servido, mas o pipeline/sources da web nao estao no repo tracked. |

# 19. Variaveis de ambiente, configs e flags

| Item | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| `.env` local do app | parcial | `.env` (worktree local), `src/core/config.ts`, `index.js` | Contem `ALERT_API_URL`, timeout e chaves Firebase client; nao esta tracked. |
| Host API mobile | parcial | `.env` local, `src/core/config.ts`, `index.js` | Existe drift entre host legado no `.env`, host `onrender` no app e host canonico do billing. |
| Runtime globals de mapa | ativo | `src/core/config.ts` | `AUTH_ANONYMOUS_ENABLED`, `MAP_PROVIDER`, `MAPTILER_KEY`, `MAP_STYLE_DEFAULT_URL`, `MAP_STYLE_SATELLITE_URL`, `MAP_SATELLITE_ENABLED`, `SECURITY_MAP_V2_ENABLED`. |
| Gradle flags Android | ativo | `android/gradle.properties`, `android/app/build.gradle` | `alertBundleDebugJs`, `newArchEnabled`, `hermesEnabled`, `reactNativeArchitectures`. |
| Backend env de billing | ativo | `backend/.env.example`, `backend/src/billing/billingConfig.js` | `STRIPE_*`, `APP_URL`, `ALERT_BILLING_*`, `PORT`. |
| Backend env de relay/rollout | ativo | `backend/index.js` | `STARLINK_CONNECT_ROLLOUT_PERCENT`, `STARLINK_TUNNEL_ROLLOUT_PERCENT`, `STARLINK_EXCLUSIVE_ROLLOUT_PERCENT`, `ALERT_PREMIUM_DEFAULT`, `ALERT_PREMIUM_USERS`, `GUARDIANS_CONVERSATION_ID`, `RELAY_HMAC_SECRET`, `RELAY_TOKEN_TTL_SEC`. |
| Firebase admin local | parcial | `backend/src/bootstrap/firebaseAdmin.js` | O backend aceita JSON inline ou arquivo local `backend/firebase-admin.json`, mas esse arquivo nao esta tracked. |
| `react-native-firebase.json` | parcial | `react-native-firebase.json` | Arquivo existe, mas esta vazio na auditoria. |

# 20. Dependencias principais por criticidade

## Alta criticidade

| Dependencia | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| `react-native`, `react`, `@react-navigation/*` | ativo | `package.json`, `App.tsx`, `src/navigation/index.tsx` | Base da app. |
| `@maplibre/maplibre-react-native` | ativo | `package.json`, telas/map widgets | Mapa e contexto espacial do produto. |
| `@react-native-firebase/app`, `auth`, `firestore`, `messaging` | ativo | `package.json`, `GuardianNetworkService.ts`, `ChatThreadService.ts`, `alertService.ts` | Auth/realtime/push. |
| `@stripe/stripe-react-native`, `stripe` backend | ativo | `package.json`, `backend/package.json`, billing files | Billing principal. |
| `@react-native-async-storage/async-storage` | ativo | muitos services | Persistencia local critica. |
| `react-native-mmkv` | ativo | `ChatPersistenceService.ts` | Persistencia de chat com melhor performance. |
| `crypto-js`, `react-native-quick-crypto`, `@msgpack/msgpack`, `pako` | ativo | relay/chat/kyber | Transporte e integridade de payloads. |
| `express`, `firebase-admin` | ativo | `backend/package.json`, `backend/index.js` | Backbone do backend. |

## Media criticidade

| Dependencia | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| `react-native-reanimated`, `gesture-handler`, `safe-area-context`, `screens` | ativo | `package.json`, `App.tsx`, `index.js` | UX/performance/navegacao. |
| `react-native-iap` | parcial | `package.json`, `AppleBillingClient.ts` | Billing iOS parcial. |
| `react-native-geolocation-service`, `react-native-permissions` | ativo | `package.json`, `SecurityContext.tsx`, `utils/permissions.ts` | Localizacao e permissoes. |
| `react-native-image-picker`, `@react-native-camera-roll/camera-roll`, `react-native-contacts` | ativo | `ProfileScreen.tsx`, `SetupContactsScreen.tsx`, `MonitoringFeedScreen.tsx` | Perfil, contatos e export/captura. |
| `react-native-webview`, `react-native-svg`, `lottie-react-native` | ativo/parcial | `package.json`, `WebViewScreen.tsx`, assets | Suporte de UI, com lottie ainda incompleta em partes. |
| `react-native-google-mobile-ads` | parcial | `package.json`, `src/ads/**` | Ads preparados, mas com rollout conservador. |

## Baixa criticidade ou legado/preparado

| Dependencia | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| `react-native-config` | nao confirmado | `package.json` | Sem uso confirmado. |
| `react-native-facebook` | nao confirmado | `package.json` | Sem uso confirmado. |
| `@react-native-firebase/analytics`, `perf`, `database` | nao confirmado | `package.json` | Presentes, sem uso runtime confirmado. |
| `react-native-sms`, `react-native-phone-call` | citado | `package.json`, i18n/permissoes | Sem uso funcional principal confirmado na auditoria. |

# 21. Recursos incompletos, stubs, mocks, TODOs e trechos suspeitos

- Verificacao de codigo mock
  - status: parcial
  - evidencia: `src/screens/auth/VerifyCodeScreen.tsx`
  - observacao: `handleVerify` apenas faz `setTimeout` e navega para `ProfileSetup`.

- Testes placeholder
  - status: parcial
  - evidencia: `backend/src/eventHub/providerRegistry.test.js`, `backend/src/eventHub/adapters/meteoAdapter.test.js`, `backend/src/billing/registerStripeBilling.test.js`
  - observacao: usam `it('placeholder', ...)` e nao validam comportamento real.

- Assistente com recursos "coming soon"
  - status: parcial
  - evidencia: `src/i18n/index.ts`
  - observacao: ha strings `assistant_attachment_coming_soon_title` e `assistant_imagine_coming_soon_title`.

- Weather lotties placeholder
  - status: parcial
  - evidencia: `src/assets/weather/lottie/*.json`
  - observacao: varios JSONs auditados sao placeholder minimo `1x1`.

- Servidor gRPC quebrado
  - status: parcial
  - evidencia: `backend/src/services/EmergencyServer.ts`, ausencia de `src/core/security/emergency.proto`, ausencia de deps gRPC em `backend/package.json`
  - observacao: modulo preparado, mas nao executavel no estado atual.

- Billing web sem fonte tracked
  - status: parcial
  - evidencia: `billing-web/dist/**`
  - observacao: so o artefato compilado esta tracked; o fonte da SPA nao foi confirmado.

- `README.md` desalinhado
  - status: parcial
  - evidencia: `README.md`
  - observacao: documento ainda descreve o template default do React Native, nao o produto Alert.

- `eslint.config.js` vazio
  - status: parcial
  - evidencia: `eslint.config.js`
  - observacao: indica drift de configuracao entre lint antigo e flat config.

- Remote official sources endpoint nao confirmado
  - status: parcial
  - evidencia: `src/services/OfficialSourcesRegistryService.ts`, ausencia de rota correspondente em `backend/index.js`
  - observacao: mobile tenta buscar remoto, mas o backend auditado nao prova esse endpoint.

# 22. Lacunas, riscos e inconsistencias

- Autenticacao real ainda incompleta
  - status: parcial
  - evidencia: `src/screens/auth/VerifyCodeScreen.tsx`
  - observacao: o app nao prova autenticacao OTP real no fluxo principal.

- Host/config drift entre mobile e backend
  - status: parcial
  - evidencia: `.env` local, `src/core/config.ts`, `index.js`, `backend/src/billing/billingConfig.js`
  - observacao: legado `api.alertpremium.com`, host `onrender` e host canonico `api.alert.app` convivem no codigo/config.

- Android release assinado com debug key
  - status: parcial
  - evidencia: `android/app/build.gradle`
  - observacao: risco alto de release/distribuicao.

- New Architecture nao ativa no Android
  - status: parcial
  - evidencia: `android/gradle.properties`
  - observacao: contradiz a stack-alvo declarada, embora a base esteja preparada.

- iOS com identidade inconsistente
  - status: parcial
  - evidencia: `app.json`, `ios/A1/Info.plist`, `ios/A1/AppDelegate.mm`
  - observacao: branding `Alert` convive com target/display `A1`.

- `NSLocationWhenInUseUsageDescription` vazio
  - status: parcial
  - evidencia: `ios/A1/Info.plist`
  - observacao: risco de permissao ruim e reprovao em App Review.

- Crash reporting externo nao confirmado
  - status: nao confirmado
  - evidencia: ausencia de uso de Sentry/Crashlytics/Analytics perf no codigo auditado
  - observacao: faltam sinais claros de observabilidade de producao.

- Billing web fonte ausente
  - status: parcial
  - evidencia: `billing-web/dist/**`
  - observacao: reduz auditabilidade, testabilidade e evolucao segura da camada web.

- Toolchain pesado dentro do repo
  - status: parcial
  - evidencia: `android/ndk/**`
  - observacao: aumenta ruido, tamanho e risco operacional do repositorio.

- Secrets/configs sensiveis exigem governanca extra
  - status: parcial
  - evidencia: `ios/Alert/GoogleService-Info.plist`, suporte a `backend/firebase-admin.json` em `firebaseAdmin.js`, `.env` local
  - observacao: parte do material sensivel esta no worktree/track e precisa de revisao de governanca.

# 23. Avaliacao de maturidade por area

| Area | Maturidade | Evidencia principal | Observacao |
| --- | --- | --- | --- |
| Shell mobile e navegacao | alta | `App.tsx`, `src/navigation/index.tsx` | Base robusta e ampla. |
| Home e UX principal | media-alta | `HomeScreen.tsx`, widgets, ThemeTokens | Rica e evoluida, mas com algum acoplamento em services/telas. |
| Clima e risco | alta | `WeatherService.ts`, `UnifiedIncidentStore.ts`, `SecurityMapScreen.tsx` | Uma das areas tecnicamente mais fortes. |
| Monitoramento/event hub | media-alta | `MonitoringFeedScreen.tsx`, `backend/src/eventHub/**` | Backend e frontend bem conectados. |
| SOS e guardioes | media-alta | `SosDispatchService.ts`, `GuardianNetworkService.ts`, chats | Fluxo forte, com relay e redundancia. |
| Chat/mensageria | media-alta | `ChatThreadService.ts`, `ChatPersistenceService.ts`, telas de chat | Persistencia e sync boas; anexos/audio ainda incompletos. |
| Widgets | alta | `src/widgets/**`, widget package Android | Modulo bem estruturado. |
| Billing Stripe | media-alta | `CheckoutScreen.tsx`, `backend/src/billing/**` | Implementacao consistente. |
| Billing Apple | media-baixa | `AppleBillingClient.ts`, backend Apple billing | Codigo existe, produto ainda parcial. |
| Auth/login | baixa | `LoginScreen.tsx`, `VerifyCodeScreen.tsx` | UX existe, autenticacao real nao esta fechada. |
| Ads/analytics | baixa-media | `src/ads/**`, `TelemetryService.ts` | Ha preparacao, mas rollout/observabilidade ainda sao limitados. |
| Seguranca hardening | media-baixa | `IntegrityCheck.ts`, `RedactionLogger.ts`, configs | Boas intencoes, mas controles declarados sem prova total de implementacao. |
| Build/release Android | media-alta | `android-release-smoke.yml`, scripts | Smoke forte, mas assinatura release e new architecture ainda sao pontos fracos. |
| Build/release iOS | media-baixa | `ios/Podfile`, `Info.plist` | Funcional, mas com inconsistencias de branding/permissao e sem pipeline equivalente confirmado. |
| Documentacao/governanca | baixa-media | `docs/*.md`, `README.md` | Existem docs pontuais, mas ha drift e lacunas. |

# 24. Conclusao final

O Alert ja e um produto tecnicamente ambicioso e bastante implementado, especialmente no mobile: clima, risco, mapas, monitoramento, guardioes, chat, SOS e billing Stripe estao efetivamente presentes no codigo e conectados por uma arquitetura hibrida entre services, contexts e bolsos de Clean Architecture/CQRS. O backend tambem e real e funcional, com billing, relay e event hub operacionais.

Ao mesmo tempo, a auditoria encontrou um conjunto claro de lacunas que impedem classificar o projeto como totalmente fechado ou homogeneo: autenticacao por OTP ainda e mock, Apple billing e parcial, New Architecture nao esta ativa no Android, a release Android ainda usa assinatura debug, ha drift de hosts/configs, a documentacao geral esta atrasada e existe codigo preparado mas incompleto, como o servidor gRPC de emergencia.

Em termos de due diligence tecnica, o estado atual do projeto pode ser resumido assim:

- produto mobile: real, amplo e funcional
- backend: real e moderadamente maduro
- billing Stripe: real e operacional
- observabilidade, autenticacao real e endurecimento de release: ainda precisam de consolidacao

Este relatorio separa o que esta ativo hoje do que esta apenas preparado, parcial, citado ou nao confirmado, sempre ancorado nos arquivos efetivamente encontrados no repositorio/worktree auditado.
