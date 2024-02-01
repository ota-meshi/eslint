"use strict";

const Prism = require("prismjs");
const { Linter } = require("../../lib/api");
const astUtils = require("../../lib/shared/ast-utils");
const { docsExampleCodeToParsableCode } = require("./code-block-utils");

/** @typedef {import("../../lib/shared/types").ParserOptions} ParserOptions */

/**
 * Content that needs to be marked with ESLint
 * @type {string|undefined}
 */
let contentMustBeMarked;

/**
 * Parser options received from the `::: incorrect` or `::: correct` container.
 * @type {ParserOptions|undefined}
 */
let contentParserOptions;

/**
 * Set content that needs to be marked.
 * @param {string} content Source code content that marks ESLint errors.
 * @param {ParserOptions} options The options used for validation.
 * @returns {void}
 */
function addContentMustBeMarked(content, options) {
    contentMustBeMarked = content;
    contentParserOptions = options;
}

/**
 * Register a hook for `Prism` to mark errors in ESLint.
 * @returns {void}
 */
function installPrismESLintMarkerHook() {
    const linter = new Linter({ configType: "flat" });

    Prism.hooks.add("after-tokenize", env => {

        if (contentMustBeMarked !== env.code) {

            // Ignore unmarked content.
            return;
        }
        contentMustBeMarked = void 0;
        const parserOptions = contentParserOptions;

        const code = env.code;

        /** Copied from SourceCode constructor */
        const lineStartIndices = [0];
        const lineEndingPattern = astUtils.createGlobalLinebreakMatcher();
        let match;

        while ((match = lineEndingPattern.exec(code))) {
            lineStartIndices.push(match.index + match[0].length);
        }

        /**
         * Converts a (line, column) pair into a range index.
         * @param {Object} loc A line/column location
         * @param {number} loc.line The line number of the location (1-indexed)
         * @param {number} loc.column The column number of the location (1-indexed)
         * @returns {number} The range index of the location in the file.
         * Copied from SourceCode#getIndexFromLoc
         */
        function getIndexFromLoc(loc) {
            const lineStartIndex = lineStartIndices[loc.line - 1];
            const positionIndex = lineStartIndex + loc.column - 1;

            return positionIndex;
        }

        /*
         * Run lint to extract the error range.
         */
        const messages = linter.verify(

            // Remove trailing newline and presentational `⏎` characters
            docsExampleCodeToParsableCode(code),
            { languageOptions: { sourceType: parserOptions.sourceType, parserOptions } },
            { filename: "code.js" }
        );

        if (messages.some(m => m.fatal)) {

            // ESLint fatal error.
            return;
        }
        const messageRanges = messages.map(message => {
            const start = getIndexFromLoc({
                line: message.line,
                column: message.column
            });

            return {
                message: message.message,
                range: [
                    start,
                    typeof message.endLine === "undefined"
                        ? start + 1
                        : getIndexFromLoc({
                            line: message.endLine,
                            column: message.endColumn
                        })
                ]
            };
        });

        /**
         * Get the content of the token.
         * @param {string | Prism.Token} token the token
         * @returns {string} the content of the token
         */
        function getTokenContent(token) {
            if (typeof token === "string") {
                return token;
            }
            if (token.type === "eslint-message") {
                return "";
            }
            if (typeof token.content === "string") {
                return token.content;
            }
            return [token.content].flat().map(getTokenContent).join("");
        }

        /**
         * Splits the given token into the `eslint-marked` token and the tokens before and after it with the specified range.
         * @param {Object} params Parameters
         * @param {string | Prism.Token} params.token Token to be split
         * @param {[number, number]} params.range Range to be marked
         * @param {string} params.message Reported message
         * @param {number} params.tokenStart Starting position of the tokens
         * @returns {{before: string | Prism.Token | null, marked: Prism.Token | null, after: string | Prism.Token | null}} converted tokens
         */
        function splitToken({ token, range, message, tokenStart }) {

            let buildToken;

            if (typeof token === "string") {
                buildToken = newContent => newContent;
            } else {
                if (typeof token.content !== "string") {
                    // eslint-disable-next-line no-use-before-define -- ignore
                    token.content = [...convertMarked({ tokens: token.content, range, message, tokenStart })];
                    return { before: null, marked: token, after: null };
                }

                buildToken = newContent => new Prism.Token(token.type, newContent, token.alias);
            }
            const content = getTokenContent(token);
            const before = tokenStart < range[0] ? buildToken(content.slice(0, range[0] - tokenStart)) : null;
            const mark = content.slice(before ? range[0] - tokenStart : 0, range[1] - tokenStart);
            const marked = new Prism.Token(
                "eslint-marked",
                [
                    buildToken(mark),

                    // A message token is a token that is displayed on hover.
                    new Prism.Token("eslint-message", message, ["alert"])
                ],
                mark === "\n" && (range[0] + 1 === range[1])
                    ? ["eslint-marked-line-feed"]
                    : []
            );
            const after = range[1] - tokenStart < token.length ? buildToken(content.slice(range[1] - tokenStart)) : null;

            return { before, marked, after };
        }

        /**
         * Generates a token stream with the `eslint-marked` class assigned to the error range.
         * @param {Object} params Parameters
         * @param {string | Prism.Token | (string | Prism.Token[])} params.tokens Tokens to be converted
         * @param {[number, number]} params.range Range to be marked
         * @param {string} params.message Reported message
         * @param {number} params.tokenStart Starting position of the tokens
         * @returns {IterableIterator<string | Prism.Token>} converted tokens
         */
        function *convertMarked({ tokens, range, message, tokenStart = 0 }) {
            let start = tokenStart;

            const buffer = [tokens].flat();

            let token;

            while ((token = buffer.shift())) {
                const content = getTokenContent(token);
                const end = start + content.length;

                if (!content || end <= range[0]) {
                    yield token;
                    start = end;
                    continue;
                }

                // Split tokens
                const result = splitToken({ token, range, message, tokenStart: start });

                if (result.before) {
                    yield result.before;
                }
                let nextTokenStartIndex = end;

                while (nextTokenStartIndex < range[1] && buffer.length) {
                    const nextToken = buffer.shift();
                    const next = splitToken({ token: nextToken, range, message, tokenStart: nextTokenStartIndex });

                    // Pops duplicate message token.
                    result.marked.content.pop();

                    result.marked.content.push(...next.marked.content);
                    if (next.after) {
                        result.after = next.after;
                    }
                    nextTokenStartIndex += getTokenContent(nextToken).length;
                }

                yield result.marked;
                if (result.after) {
                    yield result.after;
                }

                yield* buffer;
                return;
            }
        }

        for (const { range, message } of messageRanges) {
            env.tokens = [...convertMarked({ tokens: env.tokens, range, message })];
        }
    });
}


module.exports = { installPrismESLintMarkerHook, addContentMustBeMarked };
