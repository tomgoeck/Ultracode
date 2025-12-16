// Central JSDoc typedefs for the MAKER-style coding agent skeleton.

/**
 * @typedef {Object} RedFlagRule
 * @property {number=} maxChars
 * @property {number=} maxTokens
 * @property {RegExp=} requiredRegex
 * @property {boolean=} requireJson
 */

/**
 * @typedef {Object} Candidate
 * @property {string} model
 * @property {string} output
 * @property {string[]} redFlags
 * @property {number} voteCount
 * @property {Object<string, any>=} metrics
 */

/**
 * @typedef {Object} Step
 * @property {string} id
 * @property {string} taskId
 * @property {string} intent
 * @property {string[]} stateRefs
 * @property {"pending"|"running"|"completed"|"failed"|"paused"} status
 * @property {Candidate[]} candidates
 * @property {Candidate=} winner
 * @property {RedFlagRule[]} redFlags
 * @property {number} k
 * @property {number} nSamples
 * @property {number=} initialSamples
 * @property {number=} maxSamples
 * @property {string=} voteModel
 * @property {number=} temperature
 * @property {string=} command
 * @property {ApplyAction=} apply
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} goal
 * @property {"low"|"med"|"high"} risk
 * @property {string} model
 * @property {string=} voteModel
 * @property {number} k
 * @property {number} nSamples
 * @property {number=} initialSamples
 * @property {number=} maxSamples
 * @property {number=} temperature
 * @property {RedFlagRule[]} redFlags
 * @property {Step[]} steps
 */

/**
 * @typedef {Object} CommandPolicy
 * @property {"low"|"med"|"high"} severity
 * @property {boolean=} allowNetwork
 */

/**
 * @typedef {Object} ApplyAction
 * @property {"writeFile"|"appendFile"|"statePatch"|"writeFileFromState"} type
 * @property {string=} path
 * @property {boolean=} dryRun
 * @property {string=} stateKey
 */

module.exports = {};
