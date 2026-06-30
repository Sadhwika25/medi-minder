// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// CHANGE: This is now an HTTP trigger instead of a scheduled trigger
exports.sendReminderNotifications = functions.https.onRequest(async (req, res) => {
    const db = admin.database();
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    console.log(`⏰ Checking reminders at ${currentTime}`);

    try {
        // --- Everything below here is exactly the same as before ---
        const medicinesSnapshot = await db.ref('medicines').once('value');
        const medicines = medicinesSnapshot.val();

        if (!medicines) {
            console.log('No medicines found.');
            res.status(200).send('No medicines found.');
            return;
        }

        const tokensSnapshot = await db.ref('fcmTokens').once('value');
        const tokensData = tokensSnapshot.val();

        if (!tokensData) {
            console.log('No FCM tokens found.');
            res.status(200).send('No FCM tokens found.');
            return;
        }

        const deviceTokens = Object.values(tokensData).map(entry => entry.token);
        console.log(`Found ${deviceTokens.length} device(s).`);

        for (const [id, med] of Object.entries(medicines)) {
            if (med.takenToday) continue;
            if (med.times && med.times.includes(currentTime)) {
                console.log(`💊 Reminder due for: ${med.name}`);

                const payload = {
                    notification: {
                        title: `⏰ Time to take ${med.name}!`,
                        body: `Please take your ${med.name} now.`,
                    },
                    webpush: {
                        fcm_options: {
                            link: 'https://YOUR_APP_URL.com' // Replace later
                        }
                    }
                };

                await admin.messaging().sendToDevice(deviceTokens, payload);
                console.log(`✅ Notification sent to ${deviceTokens.length} device(s).`);
                break;
            }
        }
        // --- End of your existing logic ---

        // Send a success response back to the cron service
        res.status(200).send('Reminder check completed.');

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).send('Error: ' + error.message);
    }
});