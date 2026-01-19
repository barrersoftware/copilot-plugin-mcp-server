#!/usr/bin/env node

/**
 * Test token optimization on sample GitHub MCP tool
 */

const sampleTool = {
  name: "create_issue",
  description: "Create a new issue in a GitHub repository. This tool allows you to create issues with a title, body, labels, assignees, milestone, and project. The issue will be created in the repository specified by the owner and repo parameters. You must have write access to the repository to create issues. The body parameter supports GitHub Flavored Markdown for formatting.",
  inputSchema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "The account owner of the repository. The name is not case sensitive and must be a valid GitHub username or organization name. This is typically your username or the organization that owns the repository.",
      },
      repo: {
        type: "string", 
        description: "The name of the repository. The name is not case sensitive. This is the repository where you want to create the issue.",
      },
      title: {
        type: "string",
        description: "The title of the issue. This will be displayed at the top of the issue page and should be a concise summary of the issue.",
      },
      body: {
        type: "string",
        description: "The contents of the issue. This supports GitHub Flavored Markdown for formatting. You can include code blocks, lists, links, and other markdown formatting.",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Labels to associate with this issue. You must have write access to the repository to add labels.",
      },
      assignees: {
        type: "array",
        items: { type: "string" },
        description: "Logins for Users to assign to this issue. You must have write access to the repository to assign users.",
      },
    },
    required: ["owner", "repo", "title"],
  },
};

// Token optimization functions (same as proxy-server.js)
function compressDescription(desc) {
  if (!desc) return desc;
  
  let compressed = desc
    .replace(/This tool allows you to /gi, '')
    .replace(/You must have .+ access to .+?\./gi, '')
    .replace(/The .+ parameter /gi, '')
    .replace(/\. The .+ is not case sensitive/gi, '')
    .replace(/supports GitHub Flavored Markdown/gi, 'GFM')
    .replace(/GitHub repository/gi, 'repo')
    .replace(/repository/gi, 'repo')
    .replace(/organization/gi, 'org')
    .replace(/pull request/gi, 'PR')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (compressed.length > 100) {
    const firstSentence = compressed.match(/^[^.!?]+[.!?]/);
    if (firstSentence) {
      compressed = firstSentence[0];
    } else {
      compressed = compressed.substring(0, 100) + '...';
    }
  }
  
  return compressed;
}

function simplifySchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  
  const simplified = { ...schema };
  
  if (simplified.properties) {
    simplified.properties = Object.entries(simplified.properties).reduce((acc, [key, prop]) => {
      acc[key] = {
        type: prop.type,
        ...(prop.enum && { enum: prop.enum }),
        ...(prop.items && { items: simplifySchema(prop.items) }),
        ...(prop.properties && { properties: simplifySchema(prop.properties).properties }),
      };
      if (prop.description && prop.description.length < 30) {
        acc[key].description = prop.description;
      }
      return acc;
    }, {});
  }
  
  const result = {
    type: simplified.type,
    ...(simplified.properties && { properties: simplified.properties }),
    ...(simplified.required && { required: simplified.required }),
    ...(simplified.items && { items: simplifySchema(simplified.items) }),
  };
  
  return result;
}

// Test
const original = JSON.stringify(sampleTool, null, 2);
const optimized = JSON.stringify({
  name: sampleTool.name,
  description: compressDescription(sampleTool.description),
  inputSchema: simplifySchema(sampleTool.inputSchema),
}, null, 2);

console.log("=== ORIGINAL TOOL (GitHub MCP) ===");
console.log(original);
console.log("\n=== OPTIMIZED TOOL (Our Proxy) ===");
console.log(optimized);

const originalBytes = original.length;
const optimizedBytes = optimized.length;
const savings = ((1 - optimizedBytes / originalBytes) * 100).toFixed(1);

console.log("\n=== TOKEN SAVINGS ===");
console.log(`Original:  ${originalBytes} bytes`);
console.log(`Optimized: ${optimizedBytes} bytes`);
console.log(`Savings:   ${savings}% reduction`);
console.log(`\nEstimated token reduction: ~${Math.round(originalBytes / 4)} → ~${Math.round(optimizedBytes / 4)} tokens`);
