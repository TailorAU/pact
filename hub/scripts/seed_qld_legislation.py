#!/usr/bin/env python3
"""
Seed QLD Legislation into PACT Hub's Structured Legislation API.

This ingests real Queensland statutes with canonical section IDs,
content summaries, cross-references, and amendment status.

Usage:
    python scripts/seed_qld_legislation.py [--base-url URL] [--admin-key KEY]

Defaults:
    --base-url https://pacthub.ai
    --admin-key (reads from ADMIN_SECRET env var)
"""

import requests
import os
import sys
import argparse
import json

# ── Configuration ──────────────────────────────────────────────────
DEFAULT_BASE = "https://pacthub.ai"

# ── QLD Legislation Data ──────────────────────────────────────────
# Each document has real section numbers from legislation.qld.gov.au
# Content is summarized for agent consumption (not full gazette text)

QLD_ACTS = [
    {
        "id": "qld/act-1899-009",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Criminal Code Act 1899 (Qld)",
        "shortTitle": "Criminal Code 1899",
        "year": 1899,
        "number": "Act No. 9 of 1899",
        "inForceDate": "1901-01-01",
        "lastAmendedDate": "2024-10-01",
        "administeredBy": "Queensland Parliamentary Counsel",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1899-009",
        "sections": [
            {"sectionId": "s 1", "title": "Short title", "content": "This Act may be cited as the Criminal Code Act 1899.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 23", "title": "Intention — Loss of control", "content": "A person is not criminally responsible for an act or omission that occurs independently of the exercise of the person's will, or for an event that occurs by accident. Unless the intention to cause a particular result is expressly declared to be an element of the offence constituted, in whole or part, by an act or omission, the result intended to be caused by an act or omission is immaterial. Unless otherwise expressly declared, the motive by which a person is induced to do or omit to do an act, or to form an intention, is immaterial so far as regards criminal responsibility.", "depth": 2, "order": 1, "parentSection": "Chapter 5 — Criminal Responsibility", "status": "in_force", "crossReferences": ["s 24", "s 31"]},
            {"sectionId": "s 24", "title": "Mistake of fact", "content": "A person who does or omits to do an act under an honest and reasonable, but mistaken, belief in the existence of any state of things is not criminally responsible for the act or omission to any greater extent than if the real state of things had been such as the person believed to exist. The operation of this rule may be excluded by the express or implied provisions of the law relating to the subject.", "depth": 2, "order": 2, "parentSection": "Chapter 5 — Criminal Responsibility", "status": "in_force", "crossReferences": ["s 23"]},
            {"sectionId": "s 31", "title": "Compulsion and duress", "content": "A person is not criminally responsible for an act or omission if the person does or omits to do the act under threats on the part of a person of instant death or grievous bodily harm to the person or the person's spouse or de facto partner, child, or parent, if the person believes and there are reasonable grounds for believing that the person making the threats is in a position to execute them, and if the threats are made immediately before the act or omission. This defence does not extend to an act of intentional killing or an attempt to kill.", "depth": 2, "order": 3, "parentSection": "Chapter 5 — Criminal Responsibility", "status": "in_force", "crossReferences": ["s 23", "s 302"]},
            {"sectionId": "s 271", "title": "Duress", "content": "A person is not criminally responsible for an offence if the person commits the offence under duress. A person commits an offence under duress if the person reasonably believes that a threat of serious harm will be carried out unless an offence is committed, the conduct is a reasonable response to the threat, and there is no reasonable way the threat can be rendered ineffective. This section does not apply to murder, attempted murder, or to offences involving serious violence against the person.", "depth": 2, "order": 4, "parentSection": "Chapter 5 — Criminal Responsibility", "status": "in_force", "crossReferences": ["s 31"]},
            {"sectionId": "s 300", "title": "Unlawful killing", "content": "Except as hereinafter set forth, any person who unlawfully kills another is guilty of a crime. An unlawful killing may constitute murder or manslaughter according to the circumstances of the case.", "depth": 2, "order": 10, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 302", "s 303", "s 305"]},
            {"sectionId": "s 302", "title": "Definition of murder", "content": "Except as hereinafter set forth, a person who unlawfully kills another under any of the following circumstances, that is to say — (1) if the offender intends to cause the death of the person killed or that of some other person or if the offender intends to do to the person killed or to some other person some grievous bodily harm; (2) if death is caused by means of an act done in the prosecution of an unlawful purpose, which act is of such a nature as to be likely to endanger human life; (3) if the offender intends to do grievous bodily harm to some person for the purpose of facilitating the commission of a crime which is such that the offender may be arrested without warrant, or for the purpose of facilitating the flight of an offender who has committed or attempted to commit any such crime; (4) if death is caused by administering any stupefying or overpowering thing for either of the purposes last aforesaid; (5) if death is caused by wilfully stopping the breath of any person for either of such purposes; is guilty of murder.", "depth": 2, "order": 11, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 300", "s 303", "s 305"]},
            {"sectionId": "s 303", "title": "Definition of killing", "content": "Any person who causes the death of another, directly or indirectly, by any means whatever, is deemed to have killed that other person.", "depth": 2, "order": 12, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 300", "s 302"]},
            {"sectionId": "s 304", "title": "Killing on provocation", "content": "Where a person who unlawfully kills another under circumstances which, but for the provisions of this section, would constitute murder, does the act which causes death in the heat of passion caused by sudden provocation, and before there is time for the person's passion to cool, the person is guilty of manslaughter only.", "depth": 2, "order": 13, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 302", "s 308"]},
            {"sectionId": "s 305", "title": "Punishment of murder", "content": "Any person who commits the crime of murder is liable to imprisonment for life, which cannot be mitigated or varied under this Code or any other law or instrument.", "depth": 2, "order": 14, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 302"]},
            {"sectionId": "s 306", "title": "Attempt to murder", "content": "Any person who — (a) attempts unlawfully to kill another; or (b) with intent unlawfully to kill another does any act, or omits to do any act which it is the person's duty to do, such act or omission being of such a nature as to be likely to endanger human life; is guilty of a crime, and is liable to imprisonment for life.", "depth": 2, "order": 15, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 302", "s 305"]},
            {"sectionId": "s 308", "title": "Manslaughter", "content": "Any person who unlawfully kills another under such circumstances as not to constitute murder is guilty of manslaughter. A person who is guilty of manslaughter is liable to imprisonment for life.", "depth": 2, "order": 16, "parentSection": "Part 28 — Homicide — Suicide — Concealment of Birth", "status": "in_force", "crossReferences": ["s 300", "s 302", "s 304"]},
            {"sectionId": "s 320", "title": "Grievous bodily harm", "content": "Any person who unlawfully does grievous bodily harm to another is guilty of a crime, and is liable to imprisonment for 14 years.", "depth": 2, "order": 20, "parentSection": "Part 30 — Assaults and Violence to the Person Generally —டhooting and Wounding", "status": "in_force", "crossReferences": ["s 1 (definition of grievous bodily harm)", "s 339"]},
            {"sectionId": "s 328A", "title": "Dangerous operation of a vehicle", "content": "A person who operates, or in any way interferes with the operation of, a vehicle dangerously in any place commits a crime. Maximum penalty — (a) if no circumstance of aggravation exists — 3 years imprisonment; (b) if a circumstance of aggravation exists — (i) if the offence involves the death of, or grievous bodily harm to, another person — 14 years imprisonment; (ii) otherwise — 10 years imprisonment. Circumstance of aggravation includes the person being adversely affected by an intoxicating substance, excessive speed, or being a participant in an unlawful race.", "depth": 2, "order": 21, "parentSection": "Part 30 — Assaults and Violence to the Person Generally", "status": "in_force", "crossReferences": ["s 320", "Transport Operations (Road Use Management) Act 1995 s 78"]},
            {"sectionId": "s 335", "title": "Common assault", "content": "Any person who unlawfully assaults another is guilty of a misdemeanour, and is liable to imprisonment for 3 years.", "depth": 2, "order": 25, "parentSection": "Part 30 — Assaults and Violence to the Person Generally", "status": "in_force", "crossReferences": ["s 245", "s 339"]},
            {"sectionId": "s 339", "title": "Assault occasioning bodily harm", "content": "Any person who unlawfully assaults another and thereby does bodily harm to the other person is guilty of a crime, and is liable to imprisonment for 7 years. If the offender is or pretends to be armed with any dangerous or offensive weapon or instrument, or is in company with 1 or more other person or persons, the offender is liable to imprisonment for 10 years.", "depth": 2, "order": 26, "parentSection": "Part 30 — Assaults and Violence to the Person Generally", "status": "in_force", "crossReferences": ["s 335", "s 320"]},
            {"sectionId": "s 398", "title": "Stealing", "content": "Any person who steals anything capable of being stolen is guilty of a crime, and is liable, unless a greater punishment is provided, to imprisonment for 5 years. If the offender is a person employed in the public service, and the thing stolen is the property of the Crown, the offender is liable to imprisonment for 10 years.", "depth": 2, "order": 30, "parentSection": "Part 38 — Stealing", "status": "in_force", "crossReferences": ["s 391 (definition of stealing)", "s 408C"]},
            {"sectionId": "s 408C", "title": "Fraud", "content": "A person who dishonestly — (a) applies to his or her own use or to the use of any person — (i) property belonging to another; or (ii) property belonging to the person, or which is in the person's possession, either solely or jointly with another person, subject to a trust, direction or condition or on account of any other person; (b) obtains property from any person; (c) induces any person to deliver property to any person; (d) gains a benefit or advantage, pecuniary or otherwise, for any person; (e) causes a detriment, pecuniary or otherwise, to any person; (f) induces any person to do any act which the person is lawfully entitled to abstain from doing; or (g) causes any person to do any act which the person is lawfully entitled to abstain from doing; commits the crime of fraud. Maximum penalty — (a) if the property, benefit, advantage or detriment is $100,000 or more — 20 years imprisonment; (b) if the property, benefit, advantage or detriment is $30,000 or more but less than $100,000 — 14 years imprisonment; (c) if the property, benefit, advantage or detriment is $5,000 or more but less than $30,000 — 10 years imprisonment; (d) otherwise — 5 years imprisonment.", "depth": 2, "order": 31, "parentSection": "Part 39 — Robbery — Extortion by Threats", "status": "in_force", "crossReferences": ["s 398", "s 408D"]},
            {"sectionId": "s 408D", "title": "Obtaining or dealing with identification information", "content": "A person who obtains or deals with another entity's identification information for the purpose of committing, or facilitating the commission of, an indictable offence commits a crime. Maximum penalty — 3 years imprisonment.", "depth": 2, "order": 32, "parentSection": "Part 39 — Robbery — Extortion by Threats", "status": "in_force", "crossReferences": ["s 408C"]},
        ],
    },
    {
        "id": "qld/act-2009-014",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Information Privacy Act 2009 (Qld)",
        "shortTitle": "Information Privacy Act 2009",
        "year": 2009,
        "number": "Act No. 14 of 2009",
        "inForceDate": "2009-07-01",
        "lastAmendedDate": "2023-09-01",
        "administeredBy": "Office of the Information Commissioner Queensland",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-2009-014",
        "sections": [
            {"sectionId": "s 3", "title": "Purposes of Act", "content": "The purposes of this Act are to — (a) provide for the fair collection and handling in the public sector environment of personal information; and (b) provide a right of access to, and amendment of, personal information in the government's possession or under the government's control; and (c) provide for the making of privacy complaints about public sector entities and bound contracted service providers and the resolution of those complaints; and (d) authorise the Information Commissioner to monitor, audit and report on compliance with this Act.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 12", "title": "Information privacy principles", "content": "Schedule 3 sets out the information privacy principles (IPPs). An agency must comply with the IPPs in relation to the collection, storage, use, disclosure, and transfer of personal information.", "depth": 2, "order": 1, "status": "in_force", "crossReferences": ["Schedule 3"]},
            {"sectionId": "s 28", "title": "Application of this chapter", "content": "This chapter applies to a document of an agency or a document of a Minister to the extent the document contains personal information of the applicant.", "depth": 2, "order": 2, "status": "in_force"},
            {"sectionId": "IPP 1", "title": "Collection of personal information — lawful and fair", "content": "An agency must not collect personal information unless the information is collected for a lawful purpose directly related to a function or activity of the agency, and the collection of the information is necessary to fulfil that purpose. An agency must collect personal information only by lawful and fair means and not in an unreasonably intrusive way.", "depth": 3, "order": 3, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "IPP 2", "title": "Collection of personal information — solicited", "content": "If an agency collects personal information about an individual from the individual, the agency must take reasonable steps to ensure the individual is aware of the purpose of the collection, whether the collection is required or authorised by law, and to whom the agency usually discloses personal information of the kind collected.", "depth": 3, "order": 4, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "IPP 3", "title": "Collection of personal information — relevance", "content": "An agency must not collect more personal information than is necessary for the purpose of the collection.", "depth": 3, "order": 5, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "IPP 4", "title": "Storage and security of personal information", "content": "An agency having control of a document containing personal information must ensure that the information is protected against loss, unauthorised access, use, modification, disclosure, or any other misuse. An agency must take reasonable steps to destroy or permanently de-identify personal information if the information is no longer needed for any purpose.", "depth": 3, "order": 6, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "IPP 10", "title": "Limits on use of personal information", "content": "An agency that has control of a document containing personal information that was obtained for a particular purpose must not use the information for another purpose unless the individual has consented, the agency is satisfied on reasonable grounds that the use is necessary to lessen or prevent a serious threat to the life, health, safety or welfare of an individual, or the use is authorised or required under a law.", "depth": 3, "order": 10, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "IPP 11", "title": "Limits on disclosure", "content": "An agency having control of a document containing personal information must not disclose the information to an entity (the relevant entity) other than the individual the subject of the information unless one of the permitted exceptions applies, including consent, necessity to prevent serious threat, authorisation under law, or necessary for enforcement of criminal law.", "depth": 3, "order": 11, "parentSection": "Schedule 3 — Information Privacy Principles", "status": "in_force"},
            {"sectionId": "s 164", "title": "Privacy complaint to commissioner", "content": "An individual may complain to the commissioner if the individual considers an agency has failed to deal with the individual's personal information in accordance with the privacy principles, or has failed to give the individual access to, or amendment of, a document containing the individual's personal information.", "depth": 2, "order": 20, "status": "in_force"},
            {"sectionId": "s 170", "title": "Remedies — compensation and compliance", "content": "If the commissioner is satisfied that a respondent has acted in a way that is not in accordance with this Act, the commissioner may recommend that the respondent take specified action, including paying the complainant a stated amount by way of compensation for loss or damage suffered.", "depth": 2, "order": 21, "status": "in_force"},
        ],
    },
    {
        "id": "qld/act-2009-013",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Right to Information Act 2009 (Qld)",
        "shortTitle": "RTI Act 2009",
        "year": 2009,
        "number": "Act No. 13 of 2009",
        "inForceDate": "2009-07-01",
        "lastAmendedDate": "2023-09-01",
        "administeredBy": "Office of the Information Commissioner Queensland",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-2009-013",
        "relatedDocs": ["qld/act-2009-014"],
        "sections": [
            {"sectionId": "s 3", "title": "Object of Act", "content": "The object of this Act is to give a right of access to information in the government's possession or under the government's control unless, on balance, it is contrary to the public interest to give the access. The Act is to be administered with a pro-disclosure bias, meaning that access should be given to a document unless giving access would, on balance, be contrary to the public interest.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 23", "title": "Right of access", "content": "Every person has a right to be given access under this Act to documents of an agency and documents of a Minister. This right of access is subject to certain exceptions and conditions set out in the Act.", "depth": 2, "order": 1, "status": "in_force"},
            {"sectionId": "s 47", "title": "Grounds for refusal of access", "content": "A Minister or agency may refuse access to a document to the extent the document comprises exempt information, or to the extent that, on balance, disclosure of the information would be contrary to the public interest. Exempt information includes Cabinet information, Executive Council information, law enforcement information, and information subject to legal professional privilege.", "depth": 2, "order": 2, "status": "in_force", "crossReferences": ["Schedule 3 (exempt information)", "s 49 (public interest balancing test)"]},
            {"sectionId": "s 49", "title": "Public interest balancing test", "content": "In deciding whether disclosure of information would, on balance, be contrary to the public interest, a decision-maker must identify any factor favouring disclosure and any factor favouring nondisclosure, balance the factors, and decide the application in a way that promotes the pro-disclosure bias.", "depth": 2, "order": 3, "status": "in_force", "crossReferences": ["s 47", "Schedule 4"]},
            {"sectionId": "s 73", "title": "Internal review", "content": "A person who is dissatisfied with a decision of an agency in relation to an access application may apply for internal review of the decision. The application must be made within 20 business days after the day the person is given written notice of the decision.", "depth": 2, "order": 4, "status": "in_force", "crossReferences": ["s 87"]},
            {"sectionId": "s 87", "title": "External review by Information Commissioner", "content": "A person may apply to the Information Commissioner for external review of a reviewable decision. The application must be made within 20 business days after the person is given written notice of the decision. The Information Commissioner has the power to confirm, vary, or set aside the decision under review and make a decision in substitution.", "depth": 2, "order": 5, "status": "in_force", "crossReferences": ["s 73"]},
        ],
    },
    {
        "id": "qld/act-2011-018",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Work Health and Safety Act 2011 (Qld)",
        "shortTitle": "WHS Act 2011",
        "year": 2011,
        "number": "Act No. 18 of 2011",
        "inForceDate": "2012-01-01",
        "lastAmendedDate": "2024-07-01",
        "administeredBy": "Workplace Health and Safety Queensland",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-2011-018",
        "relatedDocs": ["qld/reg-2011-240"],
        "sections": [
            {"sectionId": "s 3", "title": "Object", "content": "The main object of this Act is to provide for a balanced and nationally consistent framework to secure the health and safety of workers and workplaces by — (a) protecting workers and other persons against harm to their health, safety and welfare through the elimination or minimisation of risks arising from work or from specified types of substances or plant; and (b) providing for fair and effective workplace representation, consultation, cooperation and issue resolution in relation to work health and safety.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 19", "title": "Primary duty of care", "content": "A person conducting a business or undertaking (PCBU) must ensure, so far as is reasonably practicable, the health and safety of — (a) workers engaged, or caused to be engaged, by the person; and (b) workers whose activities in carrying out work are influenced or directed by the person; while the workers are at work in the business or undertaking. A PCBU must ensure, so far as is reasonably practicable, that the health and safety of other persons is not put at risk from work carried out as part of the conduct of the business or undertaking. Maximum penalty — (a) for an individual — $300,000; (b) for a body corporate — $3,000,000.", "depth": 2, "order": 1, "parentSection": "Part 2 — Health and Safety Duties", "status": "in_force", "crossReferences": ["s 17 (management of risks)", "s 27", "s 28"]},
            {"sectionId": "s 27", "title": "Duty of officers", "content": "If a PCBU has a duty or obligation under this Act, an officer of the PCBU must exercise due diligence to ensure that the PCBU complies with that duty or obligation. Due diligence includes — (a) acquiring and keeping up-to-date knowledge of work health and safety matters; (b) understanding the nature of the operations of the business or undertaking and generally of the hazards and risks associated with those operations; (c) ensuring the PCBU has available for use, and uses, appropriate resources and processes to eliminate or minimise risks to health and safety from work.", "depth": 2, "order": 2, "parentSection": "Part 2 — Health and Safety Duties", "status": "in_force", "crossReferences": ["s 19", "s 28"]},
            {"sectionId": "s 28", "title": "Duties of workers", "content": "While at work, a worker must — (a) take reasonable care for his or her own health and safety; and (b) take reasonable care that his or her acts or omissions do not adversely affect the health and safety of other persons; and (c) comply, so far as the worker is reasonably able, with any reasonable instruction that is given by the PCBU to allow the PCBU to comply with this Act; and (d) cooperate with any reasonable policy or procedure of the PCBU relating to health or safety at the workplace that has been notified to workers. Maximum penalty — $50,000.", "depth": 2, "order": 3, "parentSection": "Part 2 — Health and Safety Duties", "status": "in_force", "crossReferences": ["s 19", "s 27"]},
            {"sectionId": "s 31", "title": "Category 1 — Reckless conduct", "content": "A person commits a category 1 offence if — (a) the person has a health and safety duty; and (b) the person, without reasonable excuse, engages in conduct that exposes an individual to whom that duty is owed to a risk of death or serious injury or illness; and (c) the person is reckless as to the risk to an individual of death or serious injury or illness. Maximum penalty — (a) for an individual as a PCBU or officer — $600,000 or 5 years imprisonment; (b) for any other individual — $300,000; (c) for a body corporate — $3,000,000.", "depth": 2, "order": 4, "parentSection": "Part 2 — Division 5 — Offences and Penalties", "status": "in_force", "crossReferences": ["s 32", "s 33"]},
            {"sectionId": "s 32", "title": "Category 2 — Failure to comply with health and safety duty", "content": "A person commits a category 2 offence if — (a) the person has a health and safety duty; and (b) the person fails to comply with that duty; and (c) the failure exposes an individual to a risk of death or serious injury or illness. Maximum penalty — (a) for an individual as a PCBU or officer — $300,000; (b) for any other individual — $150,000; (c) for a body corporate — $1,500,000.", "depth": 2, "order": 5, "parentSection": "Part 2 — Division 5 — Offences and Penalties", "status": "in_force", "crossReferences": ["s 31", "s 33"]},
            {"sectionId": "s 33", "title": "Category 3 — Failure to comply with health and safety duty", "content": "A person commits a category 3 offence if — (a) the person has a health and safety duty; and (b) the person fails to comply with that duty. This does not require exposure to risk of death or serious injury. Maximum penalty — (a) for an individual as a PCBU or officer — $100,000; (b) for any other individual — $50,000; (c) for a body corporate — $500,000.", "depth": 2, "order": 6, "parentSection": "Part 2 — Division 5 — Offences and Penalties", "status": "in_force", "crossReferences": ["s 31", "s 32"]},
            {"sectionId": "s 47", "title": "Duty to consult workers", "content": "A PCBU must, so far as is reasonably practicable, consult with workers who carry out work for the business or undertaking, and who are, or are likely to be, directly affected by a matter relating to work health or safety.", "depth": 2, "order": 7, "parentSection": "Part 5 — Consultation, Representation and Participation", "status": "in_force"},
            {"sectionId": "s 74", "title": "Health and safety representatives", "content": "Workers at a workplace may request that a PCBU who conducts business at the workplace facilitate the election of one or more health and safety representatives for the workplace or part of the workplace.", "depth": 2, "order": 8, "parentSection": "Part 5 — Division 3 — Health and Safety Representatives", "status": "in_force"},
        ],
    },
    {
        "id": "qld/act-1994-062",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Environmental Protection Act 1994 (Qld)",
        "shortTitle": "EP Act 1994",
        "year": 1994,
        "number": "Act No. 62 of 1994",
        "inForceDate": "1995-03-01",
        "lastAmendedDate": "2024-06-01",
        "administeredBy": "Department of Environment, Science and Innovation",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1994-062",
        "sections": [
            {"sectionId": "s 3", "title": "Object of Act", "content": "The object of this Act is to protect Queensland's environment while allowing for development that improves the total quality of life, both now and in the future, in a way that maintains the ecological processes on which life depends (ecologically sustainable development).", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 319", "title": "General environmental duty", "content": "A person must not carry out any activity that causes, or is likely to cause, environmental harm unless the person takes all reasonable and practicable measures to prevent or minimise the harm (the general environmental duty). Maximum penalty — 4,500 penalty units ($773,325).", "depth": 2, "order": 1, "parentSection": "Chapter 7 — General Offences and Penalties", "status": "in_force", "crossReferences": ["s 14 (definition of environmental harm)", "s 493A"]},
            {"sectionId": "s 430", "title": "Depositing prescribed contaminants", "content": "A person must not deposit a prescribed water contaminant in — (a) a roadside gutter or stormwater drain; or (b) waters. Maximum penalty — 1,665 penalty units ($286,190).", "depth": 2, "order": 2, "parentSection": "Chapter 7 — General Offences and Penalties", "status": "in_force"},
            {"sectionId": "s 440ZG", "title": "Littering", "content": "A person must not deposit litter in or on a public place, or in or on any land or waters that the person does not own or occupy, unless authorised to do so. Maximum penalty — (a) for dangerous litter — 40 penalty units ($6,876); (b) for class A litter — 30 penalty units ($5,157); (c) otherwise — 20 penalty units ($3,438).", "depth": 2, "order": 3, "parentSection": "Chapter 7 — Part 3B — Littering and Illegal Dumping", "status": "in_force"},
            {"sectionId": "s 493A", "title": "Causing serious environmental harm", "content": "A person must not wilfully and unlawfully cause serious environmental harm. Maximum penalty — (a) for an individual — 6,250 penalty units ($1,074,375) or 5 years imprisonment; (b) for a corporation — 31,250 penalty units ($5,371,875).", "depth": 2, "order": 4, "parentSection": "Chapter 7 — General Offences and Penalties", "status": "in_force", "crossReferences": ["s 319", "s 14"]},
        ],
    },
    {
        "id": "qld/act-1991-085",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Anti-Discrimination Act 1991 (Qld)",
        "shortTitle": "Anti-Discrimination Act 1991",
        "year": 1991,
        "number": "Act No. 85 of 1991",
        "inForceDate": "1991-12-09",
        "lastAmendedDate": "2024-03-01",
        "administeredBy": "Queensland Human Rights Commission",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1991-085",
        "sections": [
            {"sectionId": "s 7", "title": "Attributes on the basis of which discrimination is prohibited", "content": "Discrimination on the basis of the following attributes is prohibited under this Act — sex, relationship status, pregnancy, parental status, breastfeeding, age, race, impairment, religious belief or religious activity, political belief or activity, trade union activity, lawful sexual activity, gender identity, sexuality, family responsibilities, association with, or relation to, a person identified on the basis of any of the above attributes.", "depth": 2, "order": 0, "status": "in_force"},
            {"sectionId": "s 10", "title": "Direct discrimination", "content": "Direct discrimination on the basis of an attribute happens if a person treats, or proposes to treat, a person with an attribute less favourably than another person without the attribute is or would be treated in circumstances that are the same or not materially different.", "depth": 2, "order": 1, "status": "in_force", "crossReferences": ["s 11"]},
            {"sectionId": "s 11", "title": "Indirect discrimination", "content": "Indirect discrimination on the basis of an attribute happens if — (a) a person imposes, or proposes to impose, a term — (i) with which a person with the attribute does not or is not able to comply; but (ii) with which a higher proportion of people without the attribute comply or are able to comply; and (b) the term is not reasonable.", "depth": 2, "order": 2, "status": "in_force", "crossReferences": ["s 10"]},
            {"sectionId": "s 15", "title": "Discrimination in work", "content": "A person must not discriminate against another person in the area of work. This includes discrimination in terms of arrangements for deciding who should be offered work, in determining who should be offered work, in the terms on which work is offered, by denying or limiting access to opportunities for promotion or training, or by dismissing the worker.", "depth": 2, "order": 3, "parentSection": "Part 3 — Areas of Activity in Which Discrimination is Prohibited", "status": "in_force"},
            {"sectionId": "s 124A", "title": "Vilification on grounds of race, religion, sexuality or gender identity", "content": "A person must not, by a public act, incite hatred towards, serious contempt for, or severe ridicule of, a person or group of persons on the ground of the race, religion, sexuality or gender identity of the person or members of the group. Maximum penalty — 70 penalty units ($12,033) or 6 months imprisonment.", "depth": 2, "order": 4, "parentSection": "Part 4 — Vilification", "status": "in_force", "notes": "Section 124A was expanded in 2022 to include vilification on the grounds of gender identity."},
        ],
    },
    {
        "id": "qld/act-1974-076",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Property Law Act 1974 (Qld)",
        "shortTitle": "Property Law Act 1974",
        "year": 1974,
        "number": "Act No. 76 of 1974",
        "inForceDate": "1975-12-01",
        "lastAmendedDate": "2024-03-01",
        "administeredBy": "Department of Justice and Attorney-General",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1974-076",
        "sections": [
            {"sectionId": "s 11", "title": "Estates in fee simple", "content": "Every person who is seised of or has vested in the person a legal estate in land without any limitation as to duration is to be considered as having an estate in fee simple, or the largest estate the person can have in the land.", "depth": 2, "order": 0, "status": "in_force"},
            {"sectionId": "s 59", "title": "Contracts for sale of land to be in writing", "content": "No action may be brought upon any contract for the sale or other disposition of land or any interest in land unless the contract, upon which such action is brought, or some memorandum or note thereof, is in writing and signed by the party to be charged or by some person thereunto by the party lawfully authorised.", "depth": 2, "order": 1, "parentSection": "Part 6 — Contracts", "status": "in_force", "crossReferences": ["s 62"]},
            {"sectionId": "s 62", "title": "Conveyances to be by deed", "content": "All conveyances of land or of any interest therein are void for the purpose of conveying or creating a legal estate unless made by deed. This does not apply to assents by personal representatives, disclaimers, surrenders by operation of law, leases or tenancies not required by law to be made in writing, or receipts not required to be under seal.", "depth": 2, "order": 2, "parentSection": "Part 6 — Contracts", "status": "in_force", "crossReferences": ["s 59"]},
            {"sectionId": "s 121", "title": "Mortgages of land — creation and effect", "content": "A mortgage of land may be created by deed expressed to be by way of mortgage. The mortgagee shall not have an estate in the mortgaged land but shall have a charge thereon, with a right to possession of the land and all remedies provided by this Act.", "depth": 2, "order": 3, "parentSection": "Part 9 — Mortgages", "status": "in_force"},
            {"sectionId": "s 180", "title": "Relief against forfeiture", "content": "Where a lessor is proceeding, by action or otherwise, to enforce a right of re-entry or forfeiture under any proviso or stipulation in a lease, the lessee may, in the lessor's action or in any action brought by the lessee, apply to the court for relief. The court may grant or refuse relief, as the court having regard to the proceedings and conduct of the parties and to all the other circumstances thinks fit.", "depth": 2, "order": 4, "parentSection": "Part 8 — Leases", "status": "in_force"},
        ],
    },
    {
        "id": "qld/act-1999-010",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Child Protection Act 1999 (Qld)",
        "shortTitle": "Child Protection Act 1999",
        "year": 1999,
        "number": "Act No. 10 of 1999",
        "inForceDate": "2000-03-20",
        "lastAmendedDate": "2024-07-01",
        "administeredBy": "Department of Child Safety, Seniors and Disability Services",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1999-010",
        "sections": [
            {"sectionId": "s 5A", "title": "Paramount principle", "content": "The safety, wellbeing and best interests of a child are paramount.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 5B", "title": "Other principles for administration of Act", "content": "In the administration of this Act, the following principles apply — (a) a child has a right to be protected from harm or risk of harm; (b) a child's family has the primary responsibility for the child's upbringing, protection and development; (c) the preferred way of ensuring a child's safety and wellbeing is through supporting the child's family; (d) if a child is removed from the child's family, the child should be placed with kin, if possible.", "depth": 2, "order": 1, "status": "in_force"},
            {"sectionId": "s 13E", "title": "Mandatory reporting", "content": "A mandatory reporter who, in the course of the reporter's engagement in their profession, forms a reasonable suspicion that a child has suffered, is suffering, or is at an unacceptable risk of suffering, significant harm caused by physical or sexual abuse, and may not have a parent able and willing to protect the child from the harm, must give a written report about the suspicion to the chief executive. Mandatory reporters include doctors, nurses, teachers, police officers, and child care licensees.", "depth": 2, "order": 2, "status": "in_force", "crossReferences": ["s 13G (failure to report)", "s 186 (protection from liability)"]},
            {"sectionId": "s 13G", "title": "Failure by mandatory reporter to report", "content": "A mandatory reporter who contravenes section 13E, without reasonable excuse, commits a criminal offence. Maximum penalty — 100 penalty units ($17,190).", "depth": 2, "order": 3, "status": "in_force", "crossReferences": ["s 13E"]},
            {"sectionId": "s 51A", "title": "Placement principles — Aboriginal and Torres Strait Islander children", "content": "If an Aboriginal or Torres Strait Islander child is placed in care, the child should, if practicable, be placed with — (a) a member of the child's family; (b) a member of the child's community or language group; (c) another Aboriginal or Torres Strait Islander person; (d) another person who can ensure the child maintains connections with community, culture and identity.", "depth": 2, "order": 4, "status": "in_force"},
            {"sectionId": "s 59", "title": "Assessment orders", "content": "The chief executive may apply to a court for an assessment order if the chief executive reasonably suspects a child is in need of protection. An assessment order authorises investigation of the child's circumstances for a period not exceeding 3 months.", "depth": 2, "order": 5, "status": "in_force"},
            {"sectionId": "s 65", "title": "Child protection orders", "content": "The chief executive or a police officer may apply to the Childrens Court for a child protection order if it is believed the child is in need of protection. Orders may include supervision, custody to the chief executive, or long-term guardianship.", "depth": 2, "order": 6, "status": "in_force", "crossReferences": ["s 59", "s 82"]},
        ],
    },
    {
        "id": "qld/act-1992-048",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Penalties and Sentences Act 1992 (Qld)",
        "shortTitle": "Penalties and Sentences Act 1992",
        "year": 1992,
        "number": "Act No. 48 of 1992",
        "inForceDate": "1993-04-01",
        "lastAmendedDate": "2024-10-01",
        "administeredBy": "Department of Justice and Attorney-General",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1992-048",
        "sections": [
            {"sectionId": "s 3", "title": "Purposes", "content": "The purposes of this Act are to — (a) provide a comprehensive sentencing regime; (b) implement a consistent approach to sentencing offenders; (c) provide a legislative framework for the discretion exercised by courts in sentencing offenders.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 9", "title": "Sentencing guidelines", "content": "The court, in sentencing an offender, must have regard to — (a) the maximum and any minimum penalty prescribed for the offence; (b) the nature of the offence and how serious it is, including any physical, mental or emotional harm done to a victim; (c) the extent to which the offender is to blame for the offence; (d) any damage, injury or loss caused by the offence; (e) the offender's character, age and intellectual capacity; (f) the presence of any aggravating or mitigating factor; (g) the prevalence of the offence; (h) how much assistance the offender gave to law enforcement agencies; (i) sentences imposed on co-offenders.", "depth": 2, "order": 1, "parentSection": "Part 2 — General Principles", "status": "in_force"},
            {"sectionId": "s 92A", "title": "Suspended sentences of imprisonment", "content": "A court that sentences an offender to a term of imprisonment of 5 years or less may order that the term of imprisonment, or a part of the term, be suspended. The operational period of a suspended sentence must be for a stated period of not more than 5 years. If the offender commits another offence during the operational period and is sentenced to a further period of imprisonment, the suspended sentence is activated unless the court orders otherwise.", "depth": 2, "order": 2, "parentSection": "Part 7 — Suspended Sentences", "status": "in_force"},
            {"sectionId": "s 144", "title": "Serious violent offences", "content": "If a court convicts a person of a serious violent offence and sentences the person to 10 years or more imprisonment, the court must declare the offence to be a serious violent offence. The effect is that the offender must serve 80% of the sentence (rather than the standard 50%) before becoming eligible for parole. Serious violent offences include murder, manslaughter, grievous bodily harm, armed robbery, and certain sexual offences.", "depth": 2, "order": 3, "parentSection": "Part 9A — Serious Violent Offenders", "status": "in_force", "crossReferences": ["Schedule 1 (list of serious violent offences)", "Criminal Code s 302", "Criminal Code s 320"]},
            {"sectionId": "s 160A", "title": "Indefinite sentences", "content": "If a court convicts an offender of a serious violent offence, the court may, on the application of the Attorney-General, order that the offender be detained in custody for an indefinite term if satisfied that the offender is a serious danger to the community. The court must be satisfied on the balance of probabilities, having regard to a psychiatrist's or psychologist's report, that the offender is a serious danger.", "depth": 2, "order": 4, "parentSection": "Part 10 — Indefinite Sentences", "status": "in_force", "crossReferences": ["s 144"]},
            {"sectionId": "s 161Q", "title": "Serious organised crime circumstances of aggravation", "content": "If a court convicts a person of an offence that is a prescribed offence and the court finds that the offence was committed for a criminal organisation or as part of the person's involvement in a criminal organisation, the court must impose an extra period of imprisonment (the serious organised crime portion). The extra period is 7 years for most prescribed offences.", "depth": 2, "order": 5, "parentSection": "Part 10A — Serious Organised Crime", "status": "in_force"},
        ],
    },
    {
        "id": "qld/act-1995-009",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Transport Operations (Road Use Management) Act 1995 (Qld)",
        "shortTitle": "TORUM Act 1995",
        "year": 1995,
        "number": "Act No. 9 of 1995",
        "inForceDate": "1995-07-01",
        "lastAmendedDate": "2024-10-01",
        "administeredBy": "Department of Transport and Main Roads",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1995-009",
        "sections": [
            {"sectionId": "s 3", "title": "Object", "content": "The object of this Act is to provide for the effective and efficient management of road use in Queensland to improve road safety, the efficiency of road use, and the environmental impact of road use.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 78", "title": "Offence to drive while under the influence of liquor or a drug", "content": "A person must not drive a motor vehicle, or attempt to put a motor vehicle in motion, while under the influence of liquor or a drug. Maximum penalty — (a) first offence — 28 penalty units ($4,813) or 9 months imprisonment; (b) second offence — 60 penalty units ($10,314) or 18 months imprisonment; (c) third or subsequent offence — 120 penalty units ($20,628) or 2 years imprisonment. Minimum disqualification period applies.", "depth": 2, "order": 1, "parentSection": "Part 5 — Drink Driving and Drug Driving", "status": "in_force", "crossReferences": ["s 79", "s 79B"]},
            {"sectionId": "s 79", "title": "Driving over the general alcohol limit", "content": "A person must not drive a motor vehicle, or attempt to put a motor vehicle in motion, while the concentration of alcohol in the person's blood or breath is at or above the general alcohol limit (0.05 BAC) but below the high alcohol limit (0.15 BAC). Maximum penalty varies by offence history and BAC range. For first offence at 0.05-0.10 — 14 penalty units ($2,407) or 3 months imprisonment. Automatic licence disqualification applies.", "depth": 2, "order": 2, "parentSection": "Part 5 — Drink Driving and Drug Driving", "status": "in_force", "crossReferences": ["s 78", "s 79B"]},
            {"sectionId": "s 79B", "title": "Driving with relevant drug present in blood or saliva", "content": "A person must not drive a motor vehicle, or attempt to put a motor vehicle in motion, while a relevant drug is present in the person's blood or saliva. Relevant drugs include THC (cannabis), methylamphetamine (ice), and MDMA (ecstasy). Maximum penalty — (a) first offence — 14 penalty units ($2,407) or 3 months imprisonment; (b) second offence — 28 penalty units ($4,813) or 6 months imprisonment; (c) subsequent — 60 penalty units ($10,314) or 12 months imprisonment.", "depth": 2, "order": 3, "parentSection": "Part 5 — Drink Driving and Drug Driving", "status": "in_force", "crossReferences": ["s 78", "s 79"]},
            {"sectionId": "s 83", "title": "Disqualification of drivers", "content": "A court that convicts a person of a drink driving or drug driving offence may, in addition to any other penalty, disqualify the person from holding or obtaining a driver licence for a period determined by the court, subject to minimum disqualification periods prescribed by the Act. For high range drink driving offences, the minimum disqualification is 6 months (first offence) or 1 year (repeat offence).", "depth": 2, "order": 4, "parentSection": "Part 5 — Drink Driving and Drug Driving", "status": "in_force", "crossReferences": ["s 78", "s 79"]},
            {"sectionId": "s 91", "title": "Speeding", "content": "The driver of a motor vehicle must not drive at a speed more than the speed limit applying to the driver for the length of road where the driver is driving. Speed limits are set by regulation and signage. Penalties are determined by the excess speed: (a) up to 13km/h over — 1 penalty unit; (b) 13-20km/h over — 3 penalty units; (c) 20-30km/h over — 6 penalty units; (d) 30-40km/h over — 8 penalty units; (e) 40km/h+ over — 20 penalty units and mandatory court appearance.", "depth": 2, "order": 5, "parentSection": "Part 6 — Speed Limits", "status": "in_force"},
        ],
    },
    {
        "id": "qld/act-1980-035",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Bail Act 1980 (Qld)",
        "shortTitle": "Bail Act 1980",
        "year": 1980,
        "number": "Act No. 35 of 1980",
        "inForceDate": "1980-07-01",
        "lastAmendedDate": "2024-10-01",
        "administeredBy": "Department of Justice and Attorney-General",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1980-035",
        "sections": [
            {"sectionId": "s 9", "title": "Right to release on bail", "content": "An accused person has a right to be released on bail unless the court or police officer is satisfied that there is an unacceptable risk that the defendant would fail to appear, commit an offence, endanger the safety or welfare of a person, or interfere with witnesses or otherwise obstruct the course of justice.", "depth": 2, "order": 0, "status": "in_force"},
            {"sectionId": "s 16", "title": "Conditions of bail", "content": "A court or police officer granting bail may impose such conditions as the court or police officer considers appropriate. Conditions may include — (a) requiring the defendant to reside at a stated place; (b) requiring the defendant to report to a police station; (c) requiring the defendant not to contact specified persons; (d) requiring a surety or deposit; (e) requiring the defendant to surrender passport.", "depth": 2, "order": 1, "status": "in_force", "crossReferences": ["s 9"]},
            {"sectionId": "s 16A", "title": "Show cause requirement", "content": "If a defendant is charged with a prescribed offence (including murder, serious drug offences, offences involving firearms, and certain domestic violence offences), the defendant must show cause why the defendant's detention in custody is not justified. The onus is on the defendant to demonstrate that bail should be granted.", "depth": 2, "order": 2, "status": "in_force", "notes": "Expanded by the Bail (Domestic Violence) and Another Act Amendment Act 2023 to include domestic violence offences.", "crossReferences": ["s 9"]},
            {"sectionId": "s 29", "title": "Failure to appear", "content": "A defendant who, having been released on bail, fails without reasonable excuse to surrender into custody in accordance with the terms of the defendant's bail undertaking commits an offence. Maximum penalty — (a) if the offence with which the defendant is charged is an indictable offence — 3 years imprisonment; (b) otherwise — 1 year imprisonment.", "depth": 2, "order": 3, "status": "in_force"},
            {"sectionId": "s 30", "title": "Forfeiture of bail deposit or surety", "content": "If a defendant fails to comply with a bail condition, the court may forfeit all or part of any deposit or declare all or part of a surety recognisance to be forfeited to the Crown.", "depth": 2, "order": 4, "status": "in_force", "crossReferences": ["s 29", "s 16"]},
        ],
    },
    {
        "id": "qld/act-1999-039",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Coal Mining Safety and Health Act 1999 (Qld)",
        "shortTitle": "CMSHA 1999",
        "year": 1999,
        "number": "Act No. 39 of 1999",
        "inForceDate": "2001-03-16",
        "lastAmendedDate": "2024-09-01",
        "administeredBy": "Resources Safety and Health Queensland",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1999-039",
        "relatedDocs": ["qld/reg-2017-165"],
        "sections": [
            {"sectionId": "s 3", "title": "Object of Act", "content": "The primary object of this Act is to protect the safety and health of persons at coal mines and persons who may be affected by coal mining operations.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "s 26", "title": "Obligation of coal mine operator", "content": "The coal mine operator for a coal mine has an obligation to ensure the risk to persons from coal mining operations is at an acceptable level. The obligation is met by developing and implementing a safety and health management system for the mine.", "depth": 2, "order": 1, "parentSection": "Part 3 — Safety and Health Obligations", "status": "in_force", "crossReferences": ["s 42 (safety and health management system)"]},
            {"sectionId": "s 29", "title": "Obligation of site senior executive", "content": "The site senior executive for a coal mine has the obligation of developing and implementing the safety and health management system for the mine. The site senior executive must ensure compliance with the system.", "depth": 2, "order": 2, "parentSection": "Part 3 — Safety and Health Obligations", "status": "in_force", "crossReferences": ["s 26", "s 42"]},
            {"sectionId": "s 39", "title": "Obligations of coal mine workers", "content": "A coal mine worker at a coal mine must — (a) comply with this Act and the safety and health management system; (b) not wilfully or recklessly interfere with or misuse anything provided for safety and health; (c) use personal protective equipment provided; (d) report to the site senior executive any situation the worker believes is an imminent and serious danger.", "depth": 2, "order": 3, "parentSection": "Part 3 — Safety and Health Obligations", "status": "in_force"},
            {"sectionId": "s 42", "title": "Safety and health management system", "content": "A coal mine must have a documented safety and health management system. The system must — (a) state how the safety and health of persons at the coal mine, and other persons who may be affected by the coal mine's operations, are to be protected; (b) identify hazards, assess risk, and state how the risk will be managed; (c) state how the system will be reviewed; (d) identify competencies required for persons at the mine.", "depth": 2, "order": 4, "parentSection": "Part 4 — Safety and Health Management System", "status": "in_force", "crossReferences": ["s 26", "s 29"]},
            {"sectionId": "s 62", "title": "Inspectors — powers of entry", "content": "An inspector may, at any reasonable time, enter a coal mine or a place the inspector reasonably believes is a coal mine for the purpose of monitoring or enforcing compliance with this Act. The inspector may inspect, examine and test any plant, substance or structure at the mine.", "depth": 2, "order": 5, "parentSection": "Part 6 — Inspectors", "status": "in_force"},
            {"sectionId": "s 195", "title": "Notifiable incidents", "content": "The site senior executive of a coal mine at which a notifiable incident happens must give notice of the incident to an inspector. Notifiable incidents include — death, serious injury or illness, dangerous incident, or high potential incident. The notice must be given immediately by the fastest means possible.", "depth": 2, "order": 6, "parentSection": "Part 7 — Reporting and Investigating Incidents", "status": "in_force"},
            {"sectionId": "s 255", "title": "Offences relating to safety and health obligations", "content": "A person who contravenes a safety and health obligation under this Act commits an offence. Maximum penalty — (a) for wilful contravention causing death or grievous bodily harm — 4,500 penalty units ($773,325) or 3 years imprisonment; (b) for reckless contravention — 3,000 penalty units ($515,550); (c) otherwise — 1,500 penalty units ($257,775).", "depth": 2, "order": 7, "parentSection": "Part 14 — Offences and Proceedings", "status": "in_force", "crossReferences": ["s 26", "s 29", "s 39"]},
        ],
    },
    {
        "id": "qld/reg-2017-165",
        "jurisdiction": "QLD",
        "type": "regulation",
        "title": "Coal Mining Safety and Health Regulation 2017 (Qld)",
        "shortTitle": "CMSHR 2017",
        "year": 2017,
        "number": "SL No. 165 of 2017",
        "inForceDate": "2018-01-01",
        "lastAmendedDate": "2024-06-01",
        "administeredBy": "Resources Safety and Health Queensland",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/sl-2017-0165",
        "relatedDocs": ["qld/act-1999-039"],
        "sections": [
            {"sectionId": "r 3", "title": "Object", "content": "The object of this regulation is to prescribe safety and health requirements for coal mines, supplementing the Coal Mining Safety and Health Act 1999.", "depth": 1, "order": 0, "status": "in_force"},
            {"sectionId": "r 89", "title": "Ventilation requirements", "content": "The site senior executive must ensure that there is a ventilation system at the mine adequate to dilute, render harmless and remove noxious, flammable or other harmful gases, fumes and dust. The system must maintain atmospheric conditions suitable for persons working at the mine.", "depth": 2, "order": 1, "parentSection": "Part 6 — Ventilation and Gas Management", "status": "in_force"},
            {"sectionId": "r 108", "title": "Maximum permissible quantity of methane", "content": "The concentration of methane in the general body of air in any part of a coal mine must not exceed 2.0% by volume. If the concentration exceeds 1.25%, the site senior executive must withdraw all persons from the affected area unless they are required for the purpose of reducing the concentration.", "depth": 2, "order": 2, "parentSection": "Part 6 — Ventilation and Gas Management", "status": "in_force"},
            {"sectionId": "r 129", "title": "Strata control", "content": "The site senior executive must ensure a strata control plan is prepared for the mine. The plan must identify the geological and geotechnical conditions at the mine and state the measures to manage ground control hazards including roof falls, rib failures, and floor heave.", "depth": 2, "order": 3, "parentSection": "Part 7 — Strata Control", "status": "in_force"},
            {"sectionId": "r 178", "title": "Emergency response plan", "content": "The site senior executive must ensure an emergency response plan is prepared for the mine. The plan must provide for the safety of all persons at the mine in the event of an emergency, and must be tested and reviewed at intervals of not more than 12 months.", "depth": 2, "order": 4, "parentSection": "Part 10 — Emergency Response", "status": "in_force"},
        ],
    },
]

def main():
    parser = argparse.ArgumentParser(description="Seed QLD legislation into PACT Hub")
    parser.add_argument("--base-url", default=os.environ.get("PACT_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--admin-key", default=os.environ.get("ADMIN_SECRET", os.environ.get("PACT_ADMIN_SECRET", "")))
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    admin_key = args.admin_key

    if not admin_key:
        print("ERROR: No admin key provided. Set ADMIN_SECRET env var or use --admin-key")
        sys.exit(1)

    print(f"Seeding {len(QLD_ACTS)} QLD legislation documents to {base}")
    print(f"Total sections: {sum(len(a.get('sections', [])) for a in QLD_ACTS)}")
    print()

    # Ingest all documents in one call
    url = f"{base}/api/axiom/legislation/ingest"
    headers = {
        "Content-Type": "application/json",
        "X-Admin-Key": admin_key,
    }

    resp = requests.post(url, json={"documents": QLD_ACTS}, headers=headers, timeout=60)

    if resp.status_code != 200:
        print(f"FAILED: HTTP {resp.status_code}")
        print(resp.text[:500])
        sys.exit(1)

    data = resp.json()
    print(f"SUCCESS: Ingested {data['ingested']} documents")
    for doc in data.get("documents", []):
        print(f"  {doc['id']:30s}  {doc['sectionsInserted']:3d} sections  {doc['title']}")

    print()
    print(f"Total sections ingested: {sum(d['sectionsInserted'] for d in data.get('documents', []))}")
    print()
    print("API endpoints now available:")
    print(f"  GET {base}/api/axiom/legislation?jurisdiction=QLD")
    print(f"  GET {base}/api/axiom/legislation/qld%2Fact-1899-009")
    print(f"  GET {base}/api/axiom/legislation/search?q=assault&jurisdiction=QLD")
    print(f"  GET {base}/api/axiom/legislation/qld%2Fact-1899-009?section=s%20302&format=text")

if __name__ == "__main__":
    main()
