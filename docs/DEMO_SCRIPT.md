# VITALIS demo script

The **Run demo mission** button in the Mission Overview runs a deterministic nine-caption sequence of about three minutes. The selected crew profile is reset first. The timeline uses mission days 1-180 (engine days 0-179).

| Approx. elapsed | On-screen caption | Judge should see |
| --- | --- | --- |
| 0:00-0:15 | Healthy baseline — seven preflight days establish this crew member’s personal reference. | Baseline band and day 7. |
| 0:15-0:35 | Launch and adaptation — early congestion changes are compared with that baseline. | Mission day 15 and the launch/adaptation phase. |
| 0:35-0:55 | Sleep deprivation injected — sleep duration and efficiency drift from baseline. | Deterministic sleep scenario beginning on day 26. |
| 0:55-1:15 | Amber alert — the change is explained relative to the personal baseline. | Expanded alert explanation and the matched protocol. |
| 1:15-1:35 | Protocol opened — review its draft label, non-drug steps, source status, and disclaimer. | Full protocol panel. |
| 1:35-1:55 | Blood-pressure drift injected. | Deterministic pressure scenario begins on mission day 43. |
| 1:55-2:15 | Red alert — escalation-tier protocol has no medication guidance. | Red alert on mission day 44 and escalation protocol without medication category. |
| 2:15-2:35 | Ground link disabled — local scoring/matching continue; a check-in and scenario queue. | Offline indicator and queue count. |
| 2:35-3:00 | Link restored — wait the configured delay and sync the queued writes. | Queue count returns to zero and last-sync time updates. |

The caption intervals are deliberate pauses for an un-narrated judging presentation. Changing the link-delay slider affects the final sync wait but the remaining pause keeps the sequence near three minutes.

## Manual fallback

1. Open **Mission Overview** and use the mission-day slider to show preflight and launch/adaptation days.
2. Choose **SLEEP DEPRIVATION** and open the resulting amber alert. Expand it to show the explanation and matched draft protocol.
3. Choose **BP DRIFT** and open its escalation alert. Confirm the escalation-tier panel contains no medication category.
4. Disable the communications link, save a daily check-in, and inject a scenario. Confirm the queue count increments.
5. Restore the link. After the configured delay, confirm the queue empties and last-sync time changes.
6. Choose **Reset demo** to return the selected crew member to the deterministic baseline.

## Expected limitations

All observations and thresholds are synthetic. Protocol drafts are not approved instructions; the app is decision support only, not medical advice. The three-minute sequence is a UI presentation, not a clinical workflow or a real communications-link test.
