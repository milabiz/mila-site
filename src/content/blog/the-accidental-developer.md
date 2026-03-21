---
title: "The Accidental Developer: How SQL Carried Me for a Decade"
description: "I didn't write code for 10 years. I wrote SQL. And it solved every problem the business threw at me."
pubDate: 2026-03-21
tags: ["career", "sql", "problem-solving"]
draft: false
---

I'm not a developer. At least, I wasn't one for a very long time.

For over a decade, I was the technology leader at a national field service company — the kind of business that dispatches hundreds of technicians across the country to fix equipment at retail stores, restaurants, and commercial facilities. My job was to make the data work. And the tool I used for nearly all of it was SQL.

Not Python. Not JavaScript. Not React or Node or whatever framework launched that week. Just SQL Server, SSMS, and stored procedures. For ten years, that was enough to solve almost every problem the business threw at me.

## The Business Doesn't Care What Language You Use

When the CFO needs a revenue report by state, by entity, by GL account — they don't ask what language it's written in. They ask if the numbers are right and if it's on their desk by Monday.

When operations needs to auto-generate thousands of preventive maintenance work orders every month — they don't care that it's a stored procedure triggered by a SQL Agent job. They care that the work orders show up and the technicians get dispatched.

When a new client comes on board and we need to load 5,000 sites, map them to service zones by ZIP code, set up equipment records, configure billing, and wire up tax groups — that's not glamorous. It's SQL scripts running in sequence, each one depending on the last. Sites first, then jobs, then billing items, then equipment, then taxes. Get the order wrong and everything breaks.

I built all of this without writing what most people would call "code."

## SQL as a Swiss Army Knife

Here's what I built with SQL alone over the years:

- **A payroll calculation engine** that pulled timesheet data, applied overtime rules, calculated travel pay, handled mileage reimbursement, and exported clean files to the payroll provider
- **An entire PM scheduling system** that generated work orders on monthly, quarterly, and annual cycles for dozens of client programs — paint equipment, floor scrubbers, coffee machines, HVAC units, you name it
- **Financial reporting** that executives actually trusted — GL history, aging reports, district profitability, AP/AR reconciliation, sales tax by jurisdiction across multiple states
- **Client onboarding automation** — what used to take days of manual setup became a series of scripts that built entire service hierarchies from scratch
- **Data migration systems** that moved millions of archived work orders between schema versions without taking the system offline
- **Audit-ready exports** that kept external auditors happy during due diligence processes

Every one of those was a stored procedure, a view, or a SQL Agent job. No front end. No API. Just SQL doing the heavy lifting while the business ran on top of it.

## The Limits Eventually Show Up

Around year ten, the requests started changing. People didn't just want data pulled — they wanted to interact with it. Technicians needed a way to count inventory on their vans from a phone. Subcontractors needed a portal to manage their own work orders. Executives wanted dashboards they could click through, not static reports in their inbox.

SQL could still power all of it on the backend. But now I needed something to put in front of people. That's when I started building — web apps, dashboards, integrations, automation scripts. Not because I wanted to become a developer, but because the problems demanded it.

## The Foundation Matters More Than the Framework

Here's what I've learned: starting from the data side is an advantage most developers don't have. When something breaks in an app, I don't start with the UI — I go straight to the table. I check the data. I trace the stored procedure. Nine times out of ten, the answer is in the database.

That decade of pure SQL gave me something no bootcamp teaches: a deep understanding of how business data actually works. Not in theory. Not in a tutorial. In a live production system where getting it wrong means technicians don't get dispatched, invoices don't go out, and payroll doesn't run.

The code I write now is better because I spent ten years understanding the data first. The apps are just a layer on top of that foundation.

## What's Next

I'm writing this because I know there are other people out there like me — database professionals, analysts, accidental IT leaders — who solve real problems every day without writing what the industry calls "code." Your SQL skills are more valuable than you think.

This blog is where I'll share what I've learned: the SQL patterns that saved me, the problems that pushed me to build something new, and the lessons from over a decade of making technology work for a business that just needed things to run.

---

*More posts coming soon — real problems, real solutions, no fluff.*
