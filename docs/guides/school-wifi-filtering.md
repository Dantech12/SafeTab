# Guide for the school's IT person: blocking TikTok and games on the school Wi-Fi

*Free or low-cost · nothing installed on students' tablets · no reset*

**Goal:** while students' tablets are on the **school Wi-Fi**, block TikTok, game sites and similar services. This controls the school's own network, not the families' devices.

> Check each service's current features, limits and terms before relying on it. Free tiers and settings change.

## Option 1: Your router or firewall's built-in filtering (free if available)
Many routers and firewalls have **parental controls**, **content filtering**, **URL blocking** or **application control**.
1. Sign in to the router's admin page (the address is usually on a label on the router).
2. Find the filtering or blocking section and add the services to block, e.g. TikTok and any game sites.
3. If the router supports **schedules**, apply the block only during school hours.
4. Apply it to the **student Wi-Fi network** (ideally a separate SSID from staff Wi-Fi).

*Limit:* simple "block website" lists don't always catch apps, which use many addresses. The "application control" features on business firewalls work better.

## Option 2: A filtering DNS service (free tiers exist)
DNS filtering blocks whole services by name, for every device on the network, with nothing installed on the devices.
1. Create an account with a DNS filtering service. Some offer a free tier, often with a monthly query limit and a **block by service or app** feature, e.g. a "TikTok" toggle.
2. In the service's dashboard, block **TikTok**, **games/gaming**, and optionally **social networks** and **VPN/proxy** categories.
3. In the router's **DHCP / DNS settings** for the student network, set the DNS servers to the ones the service gives you.
4. Optionally set a **schedule** in the service so the block applies during school hours only.

Free family DNS resolvers that only block adult and malicious content will **not** block TikTok by themselves. Use a service that lets you choose specific apps.

## Make it harder to bypass
- **Block outbound DNS to anything except your chosen DNS servers** (port 53), if your router allows firewall rules.
- **Block known VPN and proxy services** using the DNS service's category, if it has one. Students commonly try VPN apps.
- **Turn off "Private DNS" bypasses where possible:** many filtering services offer guidance on blocking DNS-over-HTTPS providers.
- **Use a separate student Wi-Fi network** so staff aren't affected.

## What this can and can't do
| ✅ Works | ❌ Doesn't work |
|---|---|
| Any device on school Wi-Fi, with nothing installed | Tablets using **mobile data** or a personal hotspot |
| No reset, no access to families' devices | At home, which is the parents' choice (see the Family Link guide) |
| One setting covers the whole school | A determined student with a working VPN, if VPNs aren't blocked |

**Pair this with a classroom rule:** tablets connect to school Wi-Fi only, and mobile data stays off in class.

## Privacy
Keep DNS query logs **off**, or as short as the service allows. The school needs to block services, not to watch which sites individual students visit. Tell parents and students that the school Wi-Fi blocks certain apps during school hours.
