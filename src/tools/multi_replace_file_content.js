const fs = require('fs').promises;
const path = require('path');

module.exports = {
  definition: {
    name: "multi_replace_file_content",
    description: "Precisely edit an existing file by replacing specific blocks of text. Use this to avoid rewriting entire large files. You MUST provide the exact target text.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The absolute or relative path to the file to modify."
        },
        replacements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targetContent: {
                type: "string",
                description: "The exact, precise string block in the file to be replaced. Must include exact whitespace and indentation."
              },
              replacementContent: {
                type: "string",
                description: "The new string block that will replace the targetContent."
              }
            },
            required: ["targetContent", "replacementContent"]
          },
          description: "List of replacements to apply to the file."
        }
      },
      required: ["filePath", "replacements"]
    }
  },
  handler: async ({ filePath, replacements }) => {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    
    try {
      let content = await fs.readFile(absPath, 'utf8');
      
      let modifiedContent = content;
      let diffLogs = [];

      for (const rep of replacements) {
        const { targetContent, replacementContent } = rep;
        
        // Count occurrences
        const occurrences = modifiedContent.split(targetContent).length - 1;
        
        if (occurrences === 0) {
          return { 
            success: false, 
            error: `Target content not found in file. Ensure exact whitespace matching. Target:\n---\n${targetContent}\n---`
          };
        }
        
        if (occurrences > 1) {
           return { 
             success: false, 
             error: `Ambiguous match. Target content found ${occurrences} times in file. Target must be unique.`
           };
        }

        modifiedContent = modifiedContent.replace(targetContent, replacementContent);
        diffLogs.push(`Successfully replaced\n---\n${targetContent}\n---\nwith\n---\n${replacementContent}\n---`);
      }

      await fs.writeFile(absPath, modifiedContent, 'utf8');
      
      return { 
        success: true, 
        message: `File edited successfully. ${replacements.length} replacements applied.`,
        diffs: diffLogs
      };

    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: false, error: `File not found: ${absPath}` };
      }
      return { success: false, error: error.message };
    }
  }
};
