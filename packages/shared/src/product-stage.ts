export const PRODUCT_STAGES = [
  "IDEA",
  "PROBLEM_VALIDATION",
  "SOLUTION_VALIDATION",
  "PRE_LAUNCH",
  "LAUNCHED_ZERO_USERS",
  "EARLY_USERS",
  "FIRST_REVENUE",
  "PRODUCT_MARKET_SIGNAL",
  "GROWTH",
] as const;

export type ProductStage = (typeof PRODUCT_STAGES)[number];

export const LAUNCHED_PRODUCT_STAGES: readonly ProductStage[] = [
  "LAUNCHED_ZERO_USERS",
  "EARLY_USERS",
  "FIRST_REVENUE",
  "PRODUCT_MARKET_SIGNAL",
  "GROWTH",
];

export function isLaunchedProductStage(stage: ProductStage): boolean {
  return LAUNCHED_PRODUCT_STAGES.includes(stage);
}

export const PRODUCT_STAGE_LABELS: Record<ProductStage, string> = {
  IDEA: "Idea",
  PROBLEM_VALIDATION: "Problem validation",
  SOLUTION_VALIDATION: "Solution validation",
  PRE_LAUNCH: "Pre-launch",
  LAUNCHED_ZERO_USERS: "Launched, no users yet",
  EARLY_USERS: "Early users",
  FIRST_REVENUE: "First revenue",
  PRODUCT_MARKET_SIGNAL: "Product-market signal",
  GROWTH: "Growth",
};

export interface ProductStageGuidance {
  headline: string;
  buildPercent: number;
  marketPercent: number;
  priorities: string[];
  signals: string[];
  tasks: string[];
}

export const PRODUCT_STAGE_GUIDANCE: Record<ProductStage, ProductStageGuidance> = {
  IDEA: {
    headline: "Learn which problem is worth solving before you expand the product.",
    buildPercent: 20,
    marketPercent: 80,
    priorities: [
      "Talk with people who may have this problem",
      "Look for repeated pain and current workarounds",
      "Keep product experiments small",
    ],
    signals: ["Qualified conversations", "Repeated problem patterns", "Concrete commitments"],
    tasks: [
      "List the people most likely to experience the problem",
      "Ask a prospective customer how they handle it today",
      "Write down the strongest recurring pain you hear",
    ],
  },
  PROBLEM_VALIDATION: {
    headline: "Validate the problem with people who experience it.",
    buildPercent: 25,
    marketPercent: 75,
    priorities: [
      "Run customer interviews",
      "Test whether the problem is urgent",
      "Record current alternatives and workarounds",
    ],
    signals: ["Customer interviews", "Confirmed pain", "Pre-commitments or waitlist intent"],
    tasks: [
      "Schedule a conversation with someone in your target group",
      "Ask what the problem costs them in time or money",
      "Compare the workarounds across your conversations",
    ],
  },
  SOLUTION_VALIDATION: {
    headline: "Test whether your solution works for the people you interviewed.",
    buildPercent: 35,
    marketPercent: 65,
    priorities: [
      "Put a prototype in front of prospects",
      "Observe where people get value or get stuck",
      "Ask for a concrete next commitment",
    ],
    signals: ["Prototype tests", "Demo conversations", "Trial or purchase commitments"],
    tasks: [
      "Invite a target customer to try the smallest useful prototype",
      "Watch a user complete one important task",
      "Ask a tester what they would do next without prompting",
    ],
  },
  PRE_LAUNCH: {
    headline: "Build a path to your first real users before launch day.",
    buildPercent: 40,
    marketPercent: 60,
    priorities: [
      "Recruit beta users",
      "Prepare one dependable distribution path",
      "Keep talking with prospective customers",
    ],
    signals: ["Qualified waitlist signups", "Beta participation", "Launch conversations"],
    tasks: [
      "Invite a qualified prospect to join the beta",
      "Test the signup and first-use path",
      "Choose one launch channel and prepare its first message",
    ],
  },
  LAUNCHED_ZERO_USERS: {
    headline: "Focus on reaching people and helping the first users get started.",
    buildPercent: 25,
    marketPercent: 75,
    priorities: [
      "Do targeted outreach",
      "Make onboarding easy to complete",
      "Follow up with every new signup",
    ],
    signals: ["Qualified outreach", "Signups", "User activation"],
    tasks: [
      "Contact a likely customer with a specific reason to try the product",
      "Walk through signup as a new user",
      "Follow up with a person who visited or registered",
    ],
  },
  EARLY_USERS: {
    headline: "Learn why early users stay, return, or stop using the product.",
    buildPercent: 45,
    marketPercent: 55,
    priorities: [
      "Speak with active and inactive users",
      "Improve activation and retention",
      "Continue focused sales conversations",
    ],
    signals: ["Activation", "Repeat usage", "Customer feedback and retention"],
    tasks: [
      "Ask an active user what brings them back",
      "Reach out to a user who stopped returning",
      "Remove one observed obstacle from the first-use flow",
    ],
  },
  FIRST_REVENUE: {
    headline: "Understand what led customers to pay and make that path repeatable.",
    buildPercent: 55,
    marketPercent: 45,
    priorities: [
      "Talk with paying and lost prospects",
      "Improve the sales and onboarding path",
      "Ship product changes tied to customer evidence",
    ],
    signals: ["Paid conversions", "Time to value", "Repeatable sales conversations"],
    tasks: [
      "Ask a paying customer what made the purchase worthwhile",
      "Review one lost sale and identify the unresolved concern",
      "Document the steps from first conversation to payment",
    ],
  },
  PRODUCT_MARKET_SIGNAL: {
    headline: "Strengthen retention and identify the channels bringing the right users.",
    buildPercent: 65,
    marketPercent: 35,
    priorities: [
      "Protect retention",
      "Find repeatable acquisition",
      "Keep a regular customer feedback loop",
    ],
    signals: ["Retention", "Referrals or repeatable acquisition", "Customer outcomes"],
    tasks: [
      "Review which customer group returns most consistently",
      "Trace a recent signup to its discovery channel",
      "Ask a retained customer what would make the product essential",
    ],
  },
  GROWTH: {
    headline: "Scale the channels that work while preserving customer learning.",
    buildPercent: 70,
    marketPercent: 30,
    priorities: [
      "Invest in proven acquisition channels",
      "Track conversion and customer outcomes",
      "Keep feedback connected to product decisions",
    ],
    signals: ["Channel efficiency", "Conversion", "Retention and customer outcomes"],
    tasks: [
      "Compare conversion quality across active acquisition channels",
      "Improve one bottleneck in the strongest channel",
      "Review a recent customer outcome with the product team",
    ],
  },
};
