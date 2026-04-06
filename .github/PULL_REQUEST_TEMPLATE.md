## Android Release Gate

- [ ] Se este PR alterou Android, bundle JS, Home, mapa, widgets, push, navegacao ou fluxo critico, o check `Android Release Smoke / smoke` ficou verde antes do merge.
- [ ] Conferi os artefatos frescos do smoke (`summary.json`, `ui.xml`, `screen.png`, `device.log`) antes de aprovar ou fazer release.
- [ ] Se o workflow nao estava disponivel no runner self-hosted, rodei `.\tools\run_android_smoke_release.cmd` localmente e mantive a evidencia nova em `artifacts/android-smoke-*`.
