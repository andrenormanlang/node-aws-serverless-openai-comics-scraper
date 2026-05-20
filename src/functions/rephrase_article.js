// Import required modules
import handler from "../libs/handler-lib";
import {
  rephrase_data_from_openai,
  classify_subject_from_openai,
} from "../libs/rephrase-lib";

// Phrases that mean the AI refused / asked for the article instead of rewriting
const AI_REFUSAL_PHRASES = [
  "vänligen ge mig",
  "delat någon nyhetsartikel",
  "tyvärr kan jag inte",
  "inte tillräcklig information",
  "ge mig texten",
  "skicka nyhetsartikeln",
  "ange någon text",
];

function looksLikeRefusal(text) {
  // Empty or missing is OK (e.g. optional description/lead); only treat actual AI refusal text as error
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  if (lower.length === 0) return false;
  return AI_REFUSAL_PHRASES.some((p) => lower.includes(p));
}

// Main function to handle incoming requests
export const main = handler(async (event) => {
  try {
    // Check if the event body exists
    if (!event.body) {
      throw new Error("Request body is missing."); // Throw an error if the body is missing
    }

    // Parse the JSON body from the event
    const data = JSON.parse(event.body);

    // Rephrase the title, description, and article body concurrently
    const [rephrasedTitle, rephrasedDescription, rephrasedBody] =
      await Promise.all([
        rephrase_data_from_openai(data.title, "title"), // Rephrase the title
        rephrase_data_from_openai(data.description, "description"), // Rephrase the description
        rephrase_data_from_openai(data.articleBody, "body"), // Rephrase the article body
      ]);

    // If the AI returned refusal/error text instead of rewritten content, treat as error
    if (
      looksLikeRefusal(rephrasedTitle) ||
      looksLikeRefusal(rephrasedDescription) ||
      looksLikeRefusal(rephrasedBody)
    ) {
      return {
        response: "error",
        errorMessage:
          "Rewrite failed: please paste the full article title, description and body (not only a link or one word).",
        url: data.url,
      };
    }

    // Run subject classification (returns numeric id or 0)
    const autoSubjectId = await classify_subject_from_openai(
      rephrasedBody,
      0.1
    );

    // Return a successful response with the rephrased content and auto-assigned subject id
    return {
      response: "success",
      url: data.url,
      rwUserId: data.userId,
      rwUserName: data.userName,
      rephrasedTitle,
      rephrasedDescription,
      rephrasedBody,
      autoSubjectId,
    };
  } catch (error) {
    // Log the error and return a failure response
    return {
      response: "error", // Indicate an error occurred
      errorMessage: error.message, // Include the error message
      body: event.body, // Include the original body for debugging
    };
  }
});
