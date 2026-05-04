# Monitoring Matrix

This audit reflects the code state on 2026-04-28/29.

- The product copy still mentions "34 monitoring maps".
- The code currently defines 33 monitoring event IDs in `src/constants/MonitoringEvents.ts`.
- Provider wiring is not uniform across all 33:
  - 21 are directly provider-mapped.
  - 8 are manual-gated even when a provider or derived source exists.
  - 4 have a registry gap or drift and should not be treated as fully wired.

Legend:

- `Status`: `mapped`, `mapped_manual_gate`, `mapping_drift`, `gap_unmapped`, `manual_only`.
- `Crit`: `H` high, `M` medium, `L` low.
- `Tier`: `F+P` means base signal should stay available to free and premium.
- `Cache`: recommended hot-path cache window, not a guarantee of current runtime behavior.
- `Cost`: estimated variable cost pressure per active user path: `L/M/H`.
- `Initial`: `Y` only for the small curated opening set; never load the full catalog on app open.

| Event | Status | Crit | Tier | Cadence | Cache | Cost | Provider | Fallback | Latency | Cost Risk | Initial | On-demand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| energy_outage | mapped_manual_gate | H | F+P | 15-180m | 15m | M | infra_outages | validated-crowd | M | M | Y | Y |
| water_outage | mapped_manual_gate | H | F+P | 15-180m | 15m | M | infra_outages | validated-crowd | M | M | Y | Y |
| earthquake | mapped | H | F+P | 1-5m | 2m | L | geophysical_usgs | gdacs | M | L | Y | Y |
| flood | mapped | H | F+P | 1-15m | 2-8m | H | meteo_nowcast_openmeteo + hydro_gdacs | gdacs | H | H | Y | Y |
| heat | mapping_drift | M | F+P | 5-30m | 8m | M | hydro_gdacs? | none | M | M | N | Y |
| wind | mapping_drift | M | F+P | 5-30m | 8m | M | hydro_gdacs? | none | M | M | N | Y |
| storm | mapped | H | F+P | 1-15m | 2-8m | H | meteo_nowcast_openmeteo + hydro_gdacs | gdacs | H | H | Y | Y |
| lightning | mapped | H | F+P | 1-15m | 2-8m | H | meteo_nowcast_openmeteo + hydro_gdacs | gdacs | H | H | N | Y |
| cyclone | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| tornado | gap_unmapped | H | F+P | manual | none | L | none | none | H | L | N | Y |
| hurricane | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| landslide | gap_unmapped | H | F+P | manual | none | L | none | none | H | L | N | Y |
| pandemic | mapped_manual_gate | H | F+P | 12-24h | 30m | M | health_who | national-health-authorities | M | M | Y | Y |
| epidemic | mapped_manual_gate | H | F+P | 12-24h | 30m | M | health_who | national-health-authorities | M | M | N | Y |
| snowstorm | mapped | H | F+P | 1-15m | 2-8m | H | meteo_nowcast_openmeteo + hydro_gdacs | gdacs | H | H | N | Y |
| avalanche | gap_unmapped | H | F+P | manual | none | L | none | none | H | L | N | Y |
| wildfire | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | Y | Y |
| hail | mapped | M | F+P | 1-15m | 2-8m | H | meteo_nowcast_openmeteo + hydro_gdacs | gdacs | H | H | N | Y |
| heatwave | mapped | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| tsunami | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | H | M | N | Y |
| meteor | manual_only | M | F+P | manual | none | L | none | none | H | L | N | Y |
| fog | gap_unmapped | M | F+P | manual | none | L | none | none | M | L | N | Y |
| drought | mapped | M | F+P | 5-30m | 8m | L | hydro_gdacs | none | M | L | N | Y |
| gale | mapping_drift | M | F+P | 5-30m | 8m | M | hydro_gdacs? | none | M | M | N | Y |
| volcano | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| high_tide | mapped | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| sandstorm | mapped | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| downdraft | mapped | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| volcanic_cloud | mapping_drift | H | F+P | manual/5-30m | 8m | L | hydro_gdacs? | none | M | L | N | Y |
| rogue_waves | mapped_manual_gate | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | H | M | N | Y |
| wind_gust_50 | mapped | H | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| wind_gust_10 | mapped | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |
| dust_devils | mapped_manual_gate | M | F+P | 5-30m | 8m | M | hydro_gdacs | none | M | M | N | Y |

## Immediate guidance

- Keep the initial opening set bounded to the featured subset already curated in `DEFAULT_FEATURED_EVENT_IDS`.
- Do not treat `tornado`, `landslide`, `avalanche`, or `fog` as provider-proven.
- Do not treat `heat`, `wind`, `gale`, or `volcanic_cloud` as cleanly wired until registry drift is fixed.
- Manual-gated categories should stay out of automatic first-load fan-in.
- Premium should unlock richer drill-down and frequency, not a wider first-load blast radius.
