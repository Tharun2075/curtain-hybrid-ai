// SYNTHETIC sample data. Every person, phone number, address, order number and
// account below is made up for the demo. No real customer data is used.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.

export interface Message {
  from: string;
  at: string;
  body: string;
}

export interface Thread {
  id: string;
  subject: string;
  channel: 'Email' | 'Web form' | 'Chat' | 'Pasted';
  messages: Message[];
}

export const SHOP = 'Loomhouse Linens (sample shop)';
/** The shop's own name is never a customer's personal detail. */
export const SHOP_TERMS = ['Loomhouse Linens', 'Loomhouse'];

export const THREADS: Thread[] = [
  {
    id: 'demo-damaged-parcel',
    subject: 'Damaged duvet cover, wants replacement before Friday',
    channel: 'Email',
    messages: [
      {
        from: 'Priya Raghavan',
        at: '2026-11-16 09:12',
        body:
          'Hi team,\n\nMy order ORD-58213 arrived yesterday but the duvet cover has a long tear along the seam. ' +
          'I need a replacement before Friday because my in-laws arrive on Saturday.\n\n' +
          'Please send it to 14 Lake View Road, Banjara Hills, Hyderabad 500034. ' +
          'You can call me on +91 98480 22719 if the courier needs directions.\n\nThanks,\nPriya Raghavan',
      },
      {
        from: 'Loomhouse support',
        at: '2026-11-16 11:40',
        body:
          'Hello Priya,\n\nSorry about that. Could you send a photo of the tear and confirm whether you would like a ' +
          'replacement or a refund?\n\nRegards,\nSupport desk',
      },
      {
        from: 'Priya Raghavan',
        at: '2026-11-17 08:03',
        body:
          'Photo attached. Replacement please, same colour (sage, king size). If it cannot reach me by Friday, ' +
          'a refund to my card is fine instead. My husband Arjun will be home to receive it.\n\n' +
          'Order number is ORD-58213 again, account no. LH-447120.\n\nPriya',
      },
    ],
  },
  {
    id: 'demo-wrong-address',
    subject: 'Moved house, parcel going to old address',
    channel: 'Web form',
    messages: [
      {
        from: 'Tomasz Wierzbicki',
        at: '2026-11-17 14:55',
        body:
          'Name: Tomasz Wierzbicki\nEmail: tomasz.wierz@example.net\nPhone: 07700 900461\n\n' +
          'I placed order #77310 last week and only now noticed it is going to my old flat at ' +
          'Flat 3, 22 Holloway Street, Leeds LS6 2AB. I moved to 9 Orchard Close, York YO10 5DD on Sunday. ' +
          'Can you change the delivery address? Tracking number TRK-99120443.',
      },
    ],
  },
  {
    id: 'demo-refund-chase',
    subject: 'Refund not received after return',
    channel: 'Chat',
    messages: [
      {
        from: 'Grace Okafor',
        at: '2026-11-15 18:20',
        body:
          'Hello, this is Grace Okafor. I returned two pillowcases (return RMA-30418) on 2 November and the courier ' +
          'confirmed delivery to your warehouse. I still have not received my refund of 1,499 rupees. ' +
          'My UPI id is grace.ok@okbank if that is easier.',
      },
      {
        from: 'Loomhouse support',
        at: '2026-11-15 18:31',
        body: 'Thanks Grace, checking with the warehouse now. Could you share the card you paid with (last four digits only)?',
      },
      {
        from: 'Grace Okafor',
        at: '2026-11-15 18:34',
        body:
          'It was the card ending 4417. Honestly this is the second time this has happened, the first was invoice ' +
          'INV-2210. Please sort it out this week or I will raise it with my bank.\n\nKind regards,\nGrace Okafor\n+44 20 7946 0958',
      },
    ],
  },
  {
    id: 'demo-bulk-quote',
    subject: 'Quote for 40 bedsheet sets for a guest house',
    channel: 'Email',
    messages: [
      {
        from: 'Mr. Daniel Mensah',
        at: '2026-11-14 10:05',
        body:
          'Dear Sir/Madam,\n\nI run a small guest house and would like a quote for 40 single bedsheet sets in white, ' +
          'delivered to 5 Station Road, Kochi 682011 by mid December. Please invoice the business, customer id CUST-88104.\n\n' +
          'Best regards,\nDaniel Mensah\n0484 2391 776',
      },
    ],
  },
];
