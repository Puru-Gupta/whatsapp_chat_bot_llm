# How the AQLI WhatsApp Chatbot Works

This flowchart explains the complete journey of a message in simple language, from the user's question to the final WhatsApp reply.

```mermaid
flowchart TD
    subgraph userSide ["1. User and WhatsApp"]
        user(["Student or public user"])
        question[/"WhatsApp text question"/]
        received(["Reply received"])
    end

    subgraph messagePath ["2. Message delivery"]
        metaInbound["Meta WhatsApp Cloud API"]
        webhook["Vercel webhook"]
        validMessage{"Valid new text?"}
        ignored(["Ignored safely"])
    end

    subgraph botCore ["3. Chatbot reasoning"]
        saveIncoming["Find chat and save message"]
        humanMode{"Human mode?"}
        resetRequest{"Reset request?"}
        understand["Read recent chat and understand follow-up"]
        numericQuestion{"Numeric AQLI question?"}
        simpleMessage{"Greeting or thanks?"}
        searchKnowledge["Search reports and websites"]
        composeAnswer["Create grounded answer or honest no-data reply"]
        finalizeAnswer["Add reference and coverage notice"]
    end

    subgraph trustedData ["4. Trusted information"]
        conversations[("Supabase conversations")]
        countryData[("Country data GADM0")]
        stateData[("State data GADM1")]
        documents[("Annual reports and websites")]
    end

    subgraph adminSide ["5. Administrator controls"]
        dashboard["Admin dashboard"]
        manualReply[/"Manual human reply"/]
        knowledgeManager["Knowledge manager"]
    end

    subgraph replyPath ["6. Final reply"]
        sendReply["Send one text reply"]
        metaOutbound["Meta WhatsApp Cloud API"]
        saveReply["Save final reply"]
    end

    user --> question
    question -->|"Sends"| metaInbound
    metaInbound -->|"Forwards"| webhook
    webhook -->|"Checks"| validMessage
    validMessage -->|"No"| ignored
    validMessage -->|"Yes"| saveIncoming
    saveIncoming -->|"Stores"| conversations
    saveIncoming --> humanMode

    humanMode -->|"Yes"| dashboard
    dashboard --> manualReply
    manualReply --> sendReply

    humanMode -->|"No"| resetRequest
    resetRequest -->|"Yes"| finalizeAnswer
    resetRequest -->|"No"| understand
    conversations -->|"Recent messages"| understand
    understand --> numericQuestion

    numericQuestion -->|"Yes"| countryData
    numericQuestion -->|"Yes"| stateData
    countryData --> composeAnswer
    stateData --> composeAnswer

    numericQuestion -->|"No"| simpleMessage
    simpleMessage -->|"Yes"| composeAnswer
    simpleMessage -->|"No"| searchKnowledge
    searchKnowledge -->|"Reads"| documents
    documents --> composeAnswer
    composeAnswer --> finalizeAnswer

    dashboard --> knowledgeManager
    knowledgeManager -.->|"Updates"| countryData
    knowledgeManager -.->|"Updates"| stateData
    knowledgeManager -.->|"Updates"| documents

    finalizeAnswer --> sendReply
    sendReply --> metaOutbound
    sendReply --> saveReply
    saveReply -->|"Stores"| conversations
    metaOutbound --> received

    style userSide fill:#C6FAF6,stroke:#5AD8CC
    style messagePath fill:#C2E5FF,stroke:#3DADFF
    style botCore fill:#FFECBD,stroke:#FFC943
    style trustedData fill:#DCCCFF,stroke:#874FFF
    style adminSide fill:#FFE0C2,stroke:#FF9E42
    style replyPath fill:#CDF4D3,stroke:#66D575
    style humanMode fill:#FFECBD,stroke:#FFC943
    style resetRequest fill:#FFECBD,stroke:#FFC943
    style numericQuestion fill:#FFECBD,stroke:#FFC943
    style simpleMessage fill:#FFECBD,stroke:#FFC943
    style received fill:#CDF4D3,stroke:#66D575
    style ignored fill:#D9D9D9,stroke:#B3B3B3
```

## Simple Explanation

1. A user types a text question in WhatsApp.
2. Meta's WhatsApp Cloud API sends the message to the chatbot's Vercel webhook.
3. The chatbot checks that it is a new text message, finds or creates the conversation, and saves the message in Supabase.
4. In **Human mode**, automatic answering stops and an administrator can reply from the dashboard.
5. In **AI mode**, the bot first checks for `reset`, then uses recent messages to understand follow-up questions such as “What about Bihar?”
6. Numeric questions about values, rankings, comparisons, thresholds, or trends use structured country data (GADM0) and state/province data (GADM1).
7. Explanation and methodology questions search active annual reports, methodology files, and imported website content. Greetings and thanks receive short natural replies.
8. The bot creates a grounded answer. If the available sources do not support an answer, it says that the data is unavailable instead of guessing.
9. Every automated answer receives a source reference and a notice that current structured coverage is country and state/province level only.
10. The final reply is sent once through Meta, delivered to the user, and saved in Supabase.

## Important Points

- Current structured data covers countries and states/provinces through 2024.
- District-level structured data is not currently active.
- The webhook automatically processes text messages only.
- Sending `reset` clears active conversation context, but it does not delete stored messages.
- Administrators can upload replacement CSVs, reports, documents, and website content through the Knowledge Manager.
- OpenRouter may improve the wording of report-based answers, but the bot rejects unsupported output and uses a grounded fallback.
