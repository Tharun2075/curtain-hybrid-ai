// The exact long thread pasted in the demo video (SYNTHETIC sample data).
// Keep in sync with video/work/v2/rec2.py LONG.
export const DEMO_LONG = `From: Anjali Deshpande
Sent: 2026-11-16 17:55
Hello Loomhouse team,

I run Saffron Court Guest House and we ordered 40 bedsheet sets last month, order LH-77310. 12 sets arrived with the wrong colour (grey instead of ivory) and 3 have torn hems. We have a full house from 5 December, so I need the replacements by 2 December at the latest.

Please send them to our new address: 14 Banyan Street, Jayanagar 4th Block, Bengaluru 560041. Deliveries before 11am are best because our manager Ravi Menon signs for parcels then. You can reach Ravi on +91 98450 61234 or me on +91 99001 22874.

Also, the invoice still shows our old GST contact. Please change the billing email to accounts@saffroncourt.example and keep me, Anjali Deshpande, as the contact.

---

From: Anjali Deshpande
Sent: 2026-11-16 18:40
One more thing: your colleague Tom said on the phone that you might refund the 3 torn sets instead. If so, please refund to UPI id saffroncourt@okaxis rather than the card ending 8823. We would still prefer replacements if they can reach us in time.

---

From: Ravi Menon
Sent: 2026-11-17 09:05
Hi, Ravi here from Saffron Court. Just confirming that drivers should use the side entrance, next to the bakery. The gate code is 4471. Ticket number from the call was TK-50921. Thanks.

---

From: Anjali Deshpande
Sent: 2026-11-17 13:20
Sorry, last note. If replacements are coming, could the courier text Ravi when the van is 30 minutes away? Our street floods a little after rain and the van may need to park at the corner. And please mark the parcel for Saffron Court, not for me personally, so the front desk accepts it.`;

/** Every personal value in DEMO_LONG; none may reach a cloud prompt. */
export const DEMO_LONG_SECRETS = [
  'Anjali', 'Deshpande', 'Ravi', 'Menon', 'Tom', 'LH-77310', '14 Banyan', 'Banyan Street', 'Jayanagar', '4th Block', 'Bengaluru', '560041',
  '98450 61234', '99001 22874', 'accounts@saffroncourt.example', 'saffroncourt@okaxis', '8823', '4471', 'TK-50921',
];
