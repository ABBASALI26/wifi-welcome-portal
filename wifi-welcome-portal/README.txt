WI-FI WELCOME PORTAL (Windows)

WHAT IT DOES
- Hosts a mobile-friendly welcome page on your local Wi-Fi.
- Adds a button to open your Party Hub.
- Logs visits to visits.jsonl (time + local IP) for troubleshooting.
- Does NOT scan phones, force a pop-up, or send notifications.

SETUP
1. Extract this folder to C:\HomeServer (or another folder).
2. Optional: copy your existing party-hub.html into this same folder.
3. Open PowerShell in the folder.
4. Run:
   py welcome_portal.py
   If `py` doesn't work, try `python welcome_portal.py`.
5. On the Windows PC, open http://127.0.0.1:8080
6. Find your PC's Wi-Fi IPv4 address with `ipconfig`.
7. On an Android/iPhone connected to the same Wi-Fi, open:
   http://YOUR-PC-IP:8080
   Replace YOUR-PC-IP with the PC's actual IPv4 address.

WINDOWS FIREWALL
If Windows asks, allow Python on Private networks only, if this is your trusted home network.
Do not port-forward port 8080 on your router.

IMPORTANT LIMITATION
A Python web server cannot force an ordinary Android/iPhone browser to show a welcome page merely because it joined Wi-Fi. For an automatic captive portal, use a router/access point that explicitly supports a captive portal and configure it there. This app logs visits only when someone opens the page; it does not identify every device connected to Wi-Fi.

PRIVACY
The host can see local IP addresses of visitors in the server console and visits.jsonl. Tell guests if you keep these logs. Delete visits.jsonl to clear the log.
