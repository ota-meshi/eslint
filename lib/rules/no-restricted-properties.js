/**
 * @fileoverview Rule to disallow certain object properties
 * @author Will Klein & Eli White
 */

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/** @type {import('../types').Rule.RuleModule} */
module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow certain properties on certain objects",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-properties",
		},

		schema: {
			type: "array",
			items: {
				type: "object",
				properties: {
					object: {
						type: "string",
					},
					property: {
						type: "string",
					},
					allowObjects: {
						type: "array",
						items: {
							type: "string",
						},
						uniqueItems: true,
					},
					message: {
						type: "string",
					},
				},
				anyOf: [
					{
						required: ["object"],
					},
					{
						required: ["property"],
					},
				],
				not: {
					required: ["allowObjects", "object"],
				},
				additionalProperties: false,
			},
			uniqueItems: true,
		},

		messages: {
			restrictedObjectProperty:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{objectName}}.{{propertyName}}' is restricted from being used.{{message}}",
			restrictedProperty:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{propertyName}}' is restricted from being used.{{message}}",
		},
	},

	create(context) {
		const restrictedCalls = context.options;

		if (restrictedCalls.length === 0) {
			return {};
		}

		const restrictedProperties = new Map();
		const globallyRestrictedObjects = new Map();
		const globallyRestrictedProperties = new Map();

		restrictedCalls.forEach(option => {
			const objectName = option.object;
			const propertyName = option.property;

			if (typeof objectName === "undefined") {
				globallyRestrictedProperties.set(propertyName, {
					allowObjects: option.allowObjects,
					message: option.message,
				});
			} else if (typeof propertyName === "undefined") {
				globallyRestrictedObjects.set(objectName, {
					message: option.message,
				});
			} else {
				if (!restrictedProperties.has(objectName)) {
					restrictedProperties.set(objectName, new Map());
				}

				restrictedProperties.get(objectName).set(propertyName, {
					message: option.message,
				});
			}
		});

		/**
		 * Checks if an object name is in the allowed objects list.
		 * @param {string} objectName The name of the object to check
		 * @param {string[]} [allowObjects] The list of objects to allow
		 * @returns {boolean} True if the object is allowed, false otherwise
		 */
		function isAllowedObject(objectName, allowObjects) {
			if (!allowObjects) {
				return false;
			}

			return allowObjects.includes(objectName);
		}

		/**
		 * Checks to see whether a property access is restricted, and reports it if so.
		 * @param {ASTNode} node The node to report
		 * @param {string} objectName The name of the object
		 * @param {string} propertyName The name of the property
		 * @returns {undefined}
		 */
		function checkPropertyAccess(node, objectName, propertyName) {
			if (propertyName === null) {
				return;
			}
			const matchedObject = restrictedProperties.get(objectName);
			const matchedObjectProperty = matchedObject
				? matchedObject.get(propertyName)
				: globallyRestrictedObjects.get(objectName);
			const globalMatchedProperty =
				globallyRestrictedProperties.get(propertyName);

			if (matchedObjectProperty) {
				const message = matchedObjectProperty.message
					? ` ${matchedObjectProperty.message}`
					: "";

				context.report({
					node,
					messageId: "restrictedObjectProperty",
					data: {
						objectName,
						propertyName,
						message,
					},
				});
			} else if (
				globalMatchedProperty &&
				!isAllowedObject(objectName, globalMatchedProperty.allowObjects)
			) {
				const message = globalMatchedProperty.message
					? ` ${globalMatchedProperty.message}`
					: "";

				context.report({
					node,
					messageId: "restrictedProperty",
					data: {
						propertyName,
						message,
					},
				});
			}
		}

		return {
			MemberExpression(node) {
				checkPropertyAccess(
					node,
					node.object && node.object.name,
					astUtils.getStaticPropertyName(node),
				);
			},
			ObjectPattern(node) {
				let objectName = null;

				if (node.parent.type === "VariableDeclarator") {
					if (
						node.parent.init &&
						node.parent.init.type === "Identifier"
					) {
						objectName = node.parent.init.name;
					}
				} else if (
					node.parent.type === "AssignmentExpression" ||
					node.parent.type === "AssignmentPattern"
				) {
					if (node.parent.right.type === "Identifier") {
						objectName = node.parent.right.name;
					}
				}

				node.properties.forEach(property => {
					checkPropertyAccess(
						node,
						objectName,
						astUtils.getStaticPropertyName(property),
					);
				});
			},
		};
	},
};
