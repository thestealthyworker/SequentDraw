---
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash]
runs: 2
tags: [business-map]
---

Map my cleaning business: one booking, from enquiry to paid -- and then walk
me through it step by step. Here are all my answers up front, so don't ask
me anything -- just build the map, check it, draw the open questions, add a
tour, and render it.

1. The unit of value is one cleaning booking.
2. Work arrives when a customer fills in the enquiry form on our website.
3. I decide whether to take it: I look at the postcode and the date, then
   either accept or decline.
4. Once I accept: I send a quote, the customer confirms it, I schedule a
   cleaner, the cleaner cleans the property, the cleaner fills in a job
   sheet. I do the quoting and the scheduling. Dana is the cleaner.
5. The customer gets the completed job sheet. I don't know who it actually
   goes to at their end -- I have never asked.
6. I email an invoice after the job and they pay by bank transfer. I see it
   land in the bank.
7. What goes wrong most: about a third of customers never reply to the
   quote. I don't know who chases them.
8. The enquiry form and the invoice email are software. Everything else is
   done by hand.

Use one temp folder. Save the map with its open questions as gaps.json,
re-check gaps.json, then save a 4-step tour as a patch against gaps.json to
tour.json, re-check tour.json, then render tour.json as map.html.
