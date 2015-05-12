/**
 * htmldiff.js is a library that compares HTML content. It creates a diff between two
 * HTML documents by combining the two documents and wrapping the differences with
 * <ins> and <del> tags. Here is a high-level overview of how the diff works.
 *
 * 1. Tokenize the before and after HTML with htmlToTokens.
 * 2. Generate a list of operations that convert the before list of tokens to the after
 *    list of tokens with calculateOperations, which does the following:
 *      a. Find all the matching blocks of tokens between the before and after lists of
 *         tokens with findMatchingBlocks. This is done by finding the single longest
 *         matching block with findMatch, then iteratively finding the next longest
 *         matching blocks that precede and follow the longest matching block.
 *      b. Determine insertions, deletions, and replacements from the matching blocks.
 *         This is done in calculateOperations.
 * 3. Render the list of operations by wrapping tokens with <ins> and <del> tags where
 *    appropriate with renderOperations.
 *
 * Example usage:
 *
 *   var htmldiff = require('htmldiff.js');
 *
 *   htmldiff('<p>this is some text</p>', '<p>this is some more text</p>')
 *   == '<p>this is some <ins>more </ins>text</p>'
 *
 *   htmldiff('<p>this is some text</p>', '<p>this is some more text</p>', 'diff-class')
 *   == '<p>this is some <ins class="diff-class">more </ins>text</p>'
 */
(function(){
    'use strict';

    function isEndOfTag(char){
        return char === '>';
    }

    function isStartOfTag(char){
        return char === '<';
    }

    function isWhitespace(char){
        return /^\s+$/.test(char);
    }

    function isTag(token){
        return /^\s*<[^!>][^>]*>\s*$/.test(token);
    }

    function isntTag(token){
        return !isTag(token);
    }

    function isStartofHTMLComment(word){
        return /^<!--/.test(word);
    }

    function isEndOfHTMLComment(word){
        return /--\>$/.test(word);
    }

    /**
     * Checks if the current word is the beginning of an atomic tag. An atomic tag is one whose
     * child nodes should not be compared - the entire tag should be treated as one token. This
     * is useful for tags where it does not make sense to insert <ins> and <del> tags.
     *
     * @param {string} word The characters of the current token read so far.
     *
     * @return {string|null} The name of the atomic tag if the word will be an atomic tag,
     *    null otherwise
     */
    function isStartOfAtomicTag(word){
        var result = /^<(iframe|object|math|svg|script)/.exec(word);
        return result && result[1];
    }

    /**
     * Checks if the current word is the end of an atomic tag (i.e. it has all the characters,
     * except for the end bracket of the closing tag, such as '<iframe></iframe').
     *
     * @param {string} word The characters of the current token read so far.
     * @param {string} tag The ending tag to look for.
     *
     * @return {boolean} True if the word is now a complete token (including the end tag),
     *    false otherwise.
     */
    function isEndOfAtomicTag(word, tag){
        return word.substring(word.length - tag.length - 2) === ('</' + tag);
    }

    /**
     * Checks if a tag is a void tag.
     *
     * @param {string} token The token to check.
     *
     * @return {boolean} True if the token is a void tag, false otherwise.
     */
    function isVoidTag(token){
        return /^\s*<[^>]+\/>\s*$/.test(token);
    }

    /**
     * Checks if a token can be wrapped inside a tag.
     *
     * @param {string} token The token to check.
     *
     * @return {boolean} True if the token can be wrapped inside a tag, false otherwise.
     */
    function isWrappable(token){
        return isntTag(token) || isStartOfAtomicTag(token) || isVoidTag(token);
    }

    /**
     * Creates a token that holds a string and key representation. The key is used for diffing
     * comparisons and the string is used to recompose the document after the diff is complete.
     *
     * @param {string} currentWord The section of the document to create a token for.
     *
     * @return {Object} A token object with a string and key property.
     */
    function createToken(currentWord){
        return {
            string: currentWord,
            key: getKeyForToken(currentWord)
        };
    }

    /**
     * A Match stores the information of a matching block. A matching block is a list of
     * consecutive tokens that appear in both the before and after lists of tokens.
     *
     * @param {number} startInBefore The index of the first token in the list of before tokens.
     * @param {number} startInAfter The index of the first token in the list of after tokens.
     * @param {number} length The number of consecutive matching tokens in this block.
     * @param {Segment} segment The segment where the match was found.
     */
    function Match(startInBefore, startInAfter, length, segment){
        this.segment = segment;
        this.length = length;

        this.startInBefore = startInBefore + segment.beforeIndex;
        this.startInAfter = startInAfter + segment.afterIndex;
        this.endInBefore = this.startInBefore + this.length - 1;
        this.endInAfter = this.startInAfter + this.length - 1;

        this.segmentStartInBefore = startInBefore;
        this.segmentStartInAfter = startInAfter;
        this.segmentEndInBefore = (this.segmentStartInBefore + this.length) - 1;
        this.segmentEndInAfter = (this.segmentStartInAfter + this.length) - 1;
    }

    /**
     * Tokenizes a string of HTML.
     *
     * @param {string} html The string to tokenize.
     *
     * @return {Array.<string>} The list of tokens.
     */
    function htmlToTokens(html){
        var mode = 'char';
        var currentWord = '';
        var currentAtomicTag = '';
        var words = [];
        for (var i = 0; i < html.length; i++){
            var char = html[i];
            switch (mode){
                case 'tag':
                    var atomicTag = isStartOfAtomicTag(currentWord);
                    if (atomicTag){
                        mode = 'atomic_tag';
                        currentAtomicTag = atomicTag;
                        currentWord += char;
                    } else if (isStartofHTMLComment(currentWord)){
                        mode = 'html_comment';
                        currentWord += char;
                    } else if (isEndOfTag(char)){
                        currentWord += '>';
                        words.push(createToken(currentWord));
                        currentWord = '';
                        if (isWhitespace(char)){
                            mode = 'whitespace';
                        } else {
                            mode = 'char';
                        }
                    } else {
                        currentWord += char;
                    }
                    break;
                case 'atomic_tag':
                    if (isEndOfTag(char) && isEndOfAtomicTag(currentWord, currentAtomicTag)){
                        currentWord += '>';
                        words.push(createToken(currentWord));
                        currentWord = '';
                        currentAtomicTag = '';
                        mode = 'char';
                    } else {
                        currentWord += char;
                    }
                    break;
                case 'html_comment':
                    currentWord += char;
                    if (isEndOfHTMLComment(currentWord)){
                        currentWord = '';
                        mode = 'char';
                    }
                    break;
                case 'char':
                    if (isStartOfTag(char)){
                        if (currentWord){
                            words.push(createToken(currentWord));
                        }
                        currentWord = '<';
                        mode = 'tag';
                    } else if (/\s/.test(char)){
                        if (currentWord){
                            words.push(createToken(currentWord));
                        }
                        currentWord = char;
                        mode = 'whitespace';
                    } else if (/[\w\d\#@]/.test(char)){
                        currentWord += char;
                    } else if (/&/.test(char)){
                        if (currentWord){
                            words.push(createToken(currentWord));
                        }
                        currentWord = char;
                    } else {
                        currentWord += char;
                        words.push(createToken(currentWord));
                        currentWord = '';
                    }
                    break;
                case 'whitespace':
                    if (isStartOfTag(char)){
                        if (currentWord){
                            words.push(createToken(currentWord));
                        }
                        currentWord = '<';
                        mode = 'tag';
                    } else if (isWhitespace(char)){
                        currentWord += char;
                    } else {
                        if (currentWord){
                            words.push(createToken(currentWord));
                        }
                        currentWord = char;
                        mode = 'char';
                    }
                    break;
                default:
                    throw new Error('Unknown mode ' + mode);
            }
        }
        if (currentWord){
            words.push(createToken(currentWord));
        }
        return words;
    }

    /**
     * Creates a key that should be used to match tokens. This is useful, for example, if we want
     * to consider two open tag tokens as equal, even if they don't have the same attributes. We
     * use a key instead of overwriting the token because we may want to render the original string
     * without losing the attributes.
     *
     * @param {string} token The token to create the key for.
     *
     * @return {string} The identifying key that should be used to match before and after tokens.
     */
    function getKeyForToken(token){
        var tagName = /<([^\s>]+)[\s>]/.exec(token);
        if (tagName){
            return '<' + (tagName[1].toLowerCase()) + '>';
        }
        return token && token.replace(/(\s+|&nbsp;|&#160;)/g, ' ');
    }

    /**
     * Creates a map from token key to an array of indices of locations of the matching token in
     * the list of all tokens.
     *
     * @param {Array.<string>} tokens The list of tokens to be mapped.
     *
     * @return {Object} A mapping that can be used to search for tokens.
     */
    function createMap(tokens){
        return tokens.reduce(function(map, token, index){
            if (map[token.key]){
                map[token.key].push(index);
            } else {
                map[token.key] = [index];
            }
            return map;
        }, Object.create(null));
    }

    /**
     * Compares two match objects to determine if the second match object comes before or after the
     * first match object. Returns -1 if the m2 should come before m1. Returns 1 if m1 should come
     * before m2. If the two matches criss-cross each other, a null is returned.
     *
     * @param {Match} m1 The first match object to compare.
     * @param {Match} m2 The second match object to compare.
     *
     * @return {number} Returns -1 if the m2 should come before m1. Returns 1 if m1 should come
     *    before m2. If the two matches criss-cross each other, 0 is returned.
     */
    function compareMatches(m1, m2){
        if (m2.endInBefore < m1.startInBefore && m2.endInAfter < m1.startInAfter){
            return -1;
        } else if (m2.startInBefore > m1.endInBefore && m2.startInAfter > m1.endInAfter){
            return 1;
        } else {
            return 0;
        }
    }

    /**
     * A constructor for a binary search tree used to keep match objects in the proper order as
     * they're found.
     *
     * @constructor
     */
    function MatchBinarySearchTree(){
        this._root = null;
    }

    MatchBinarySearchTree.prototype = {
        /**
         * Adds matches to the binary search tree.
         *
         * @param {Match} value The match to add to the binary search tree.
         */
        add: function (value){
            // Create the node to hold the match value.
            var node = {
                value: value,
                left: null,
                right: null
            };

            var current = this._root;
            if(current){
                while (true){
                    // Determine if the match value should go to the left or right of the current
                    // node.
                    var position = compareMatches(current.value, value);
                    if (position === -1){
                        // The position of the match is to the left of this node.
                        if (current.left){
                            current = current.left;
                        } else {
                            current.left = node;
                            break;
                        }
                    } else if (position === 1){
                        // The position of the match is to the right of this node.
                        if (current.right){
                            current = current.right;
                        } else {
                            current.right = node;
                            break;
                        }
                    } else {
                        // If 0 was returned from compareMatches, that means the node cannot
                        // be inserted because it overlaps an existing node.
                        break;
                    }
                }
            } else {
                // If no nodes exist in the tree, make this the root node.
                this._root = node;
            }
        },

        /**
         * Converts the binary search tree into an array using an in-order traversal.
         *
         * @return {Array.<Match>} An array containing the matches in the binary search tree.
         */
        toArray: function(){
            function inOrder(node, nodes){
                if (node){
                    inOrder(node.left, nodes);
                    nodes.push(node.value);
                    inOrder(node.right, nodes);
                }
                return nodes;
            }

            return inOrder(this._root, []);
        }
    };


    /**
     * Finds and returns the best match between the before and after arrays contained in the segment
     * provided.
     *
     * @param {Segment} segment The segment in which to look for a match.
     *
     * @return {Match} The best match.
     */
    function findBestMatch(segment){
        var beforeTokens = segment.beforeTokens;
        var afterMap = segment.afterMap;
        var lastSpace = null;
        var bestMatch = null;

        // Iterate through the entirety of the beforeTokens to find the best match.
        for (var beforeIndex = 0; beforeIndex < beforeTokens.length; beforeIndex++){
            var lookBehind = false;

            // If the current best match is longer than the remaining tokens, we can bail because we
            // won't find a better match.
            var remainingTokens = beforeTokens.length - beforeIndex;
            if (bestMatch && remainingTokens < bestMatch.length){
                break;
            }

            // If the current token is whitespace, make a note of it and move on. Trying to start a
            // set of matches with whitespace is not efficient because it's too prevelant in most
            // documents. Instead, if the next token yields a match, we'll see if the whitespace can
            // be included in that match.
            var beforeToken = beforeTokens[beforeIndex];
            if (beforeToken.key === ' '){
                lastSpace = beforeIndex;
                continue;
            }

            // Check to see if we just skipped a space, if so, we'll ask getFullMatch to look behind
            // by one token to see if it can include the whitespace.
            if (lastSpace === beforeIndex - 1){
                lookBehind = true;
            }

            // If the current token is not found in the afterTokens, it won't match and we can move
            // on.
            var afterTokenLocations = afterMap[beforeToken.key];
            if(!afterTokenLocations){
                continue;
            }

            // For each instance of the current token in afterTokens, let's see how big of a match
            // we can build.
            afterTokenLocations.forEach(function(afterIndex){
                // getFullMatch will see how far the current token match will go in both
                // beforeTokens and afterTokens.
                var bestMatchLength = bestMatch ? bestMatch.length : 0;
                var match = getFullMatch(
                        segment, beforeIndex, afterIndex, bestMatchLength, lookBehind);

                // If we got a new best match, we'll save it aside.
                if (match && match.length > bestMatchLength){
                    bestMatch = match;
                }
            });
        }

        return bestMatch;
    }

    /**
     * Takes the start of a match, and expands it in the beforeTokens and afterTokens of the
     * current segment as far as it can go.
     *
     * @param {Segment} segment The segment object to search within when expanding the match.
     * @param {number} beforeStart The offset within beforeTokens to start looking.
     * @param {number} afterStart The offset within afterTokens to start looking.
     * @param {number} minLength The minimum length match that must be found.
     * @param {boolean} lookBehind If true, attempt to match a whitespace token just before the
     *    beforeStart and afterStart tokens.
     *
     * @return {Match} The full match.
     */
    function getFullMatch(segment, beforeStart, afterStart, minLength, lookBehind){
        var beforeTokens = segment.beforeTokens;
        var afterTokens = segment.afterTokens;

        // If we already have a match that goes to the end of the document, no need to keep looking.
        var minBeforeIndex = beforeStart + minLength;
        var minAfterIndex = afterStart + minLength;
        if(minBeforeIndex >= beforeTokens.length || minAfterIndex >= afterTokens.length){
            return;
        }

        // If a minLength was provided, we can do a quick check to see if the tokens after that
        // length match. If not, we won't be beating the previous best match, and we can bail out
        // early.
        if (minLength){
            var nextBeforeWord = beforeTokens[minBeforeIndex].key;
            var nextAfterWord = afterTokens[minAfterIndex].key;
            if (nextBeforeWord !== nextAfterWord){
                return;
            }
        }

        // Extend the current match as far foward as it can go, without overflowing beforeTokens or
        // afterTokens.
        var searching = true;
        var currentLength = 1;
        var beforeIndex = beforeStart + currentLength;
        var afterIndex = afterStart + currentLength;

        while (searching && beforeIndex < beforeTokens.length && afterIndex < afterTokens.length){
            var beforeWord = beforeTokens[beforeIndex].key;
            var afterWord = afterTokens[afterIndex].key;
            if (beforeWord === afterWord){
                currentLength++;
                beforeIndex = beforeStart + currentLength;
                afterIndex = afterStart + currentLength;
            } else {
                searching = false;
            }
        }

        // If we've been asked to look behind, it's because both beforeTokens and afterTokens may
        // have a whitespace token just behind the current match that was previously ignored. If so,
        // we'll expand the current match to include it.
        if (lookBehind && beforeStart > 0 && afterStart > 0){
            var prevBeforeKey = beforeTokens[beforeStart - 1].key;
            var prevAfterKey = afterTokens[afterStart - 1].key;
            if (prevBeforeKey === ' ' && prevAfterKey === ' '){
                beforeStart--;
                afterStart--;
                currentLength++;
            }
        }

        return new Match(beforeStart, afterStart, currentLength, segment);
    }

    /**
     * Creates segment objects from the original document that can be used to restrict the area that
     * findBestMatch and it's helper functions search to increase performance.
     *
     * @param {Array.<Token>} beforeTokens Tokens from the before document.
     * @param {Array.<Token>} afterTokens Tokens from the after document.
     * @param {number} beforeIndex The index within the before document where this segment begins.
     * @param {number} afterIndex The index within the after document where this segment behinds.
     *
     * @return {Segment} The segment object.
     */
    function createSegment(beforeTokens, afterTokens, beforeIndex, afterIndex){
        return {
            beforeTokens: beforeTokens,
            afterTokens: afterTokens,
            beforeMap: createMap(beforeTokens),
            afterMap: createMap(afterTokens),
            beforeIndex: beforeIndex,
            afterIndex: afterIndex
        };
    }

    /**
     * Finds all the matching blocks within the given segment in the before and after lists of
     * tokens.
     *
     * @param {Segment} The segment that should be searched for matching blocks.
     *
     * @return {Array.<Match>} The list of matching blocks in this range.
     */
    function findMatchingBlocks(segment){
        // Create a binary search tree to hold the matches we find in order.
        var matches = new MatchBinarySearchTree();
        var match;
        var segments = [segment];

        // Each time the best match is found in a segment, zero, one or two new segments may be
        // created from the parts of the original segment not included in the match. We will
        // continue to iterate until all segments have been processed.
        while(segments.length){
            segment = segments.pop();
            match = findBestMatch(segment);

            if (match && match.length){
                // If there's an unmatched area at the start of the segment, create a new segment
                // from that area and throw it into the segments array to get processed.
                if (match.segmentStartInBefore > 0 && match.segmentStartInAfter > 0){
                    var leftBeforeTokens = segment.beforeTokens.slice(
                            0, match.segmentStartInBefore);
                    var leftAfterTokens = segment.afterTokens.slice(0, match.segmentStartInAfter);

                    segments.push(createSegment(leftBeforeTokens, leftAfterTokens,
                            segment.beforeIndex, segment.afterIndex));
                }

                // If there's an unmatched area at the end of the segment, create a new segment from that
                // area and throw it into the segments array to get processed.
                var rightBeforeTokens = segment.beforeTokens.slice(match.segmentEndInBefore + 1);
                var rightAfterTokens = segment.afterTokens.slice(match.segmentEndInAfter + 1);
                var rightBeforeIndex = segment.beforeIndex + match.segmentEndInBefore + 1;
                var rightAfterIndex = segment.afterIndex + match.segmentEndInAfter + 1;

                if (rightBeforeTokens.length && rightAfterTokens.length){
                    segments.push(createSegment(rightBeforeTokens, rightAfterTokens,
                            rightBeforeIndex, rightAfterIndex));
                }

                matches.add(match);
            }
        }

        return matches.toArray();
    }

    /**
     * Gets a list of operations required to transform the before list of tokens into the
     * after list of tokens. An operation describes whether a particular list of consecutive
     * tokens are equal, replaced, inserted, or deleted.
     *
     * @param {Array.<string>} beforeTokens The before list of tokens.
     * @param {Array.<string>} afterTokens The after list of tokens.
     *
     * @return {Array.<Object>} The list of operations to transform the before list of
     *      tokens into the after list of tokens, where each operation has the following
     *      keys:
     *      - {string} action One of {'replace', 'insert', 'delete', 'equal'}.
     *      - {number} startInBefore The beginning of the range in the list of before tokens.
     *      - {number} endInBefore The end of the range in the list of before tokens.
     *      - {number} startInAfter The beginning of the range in the list of after tokens.
     *      - {number} endInAfter The end of the range in the list of after tokens.
     */
    function calculateOperations(beforeTokens, afterTokens){
        if (!beforeTokens) throw new Error('Missing beforeTokens');
        if (!afterTokens) throw new Error('Missing afterTokens');

        var positionInBefore = 0;
        var positionInAfter = 0;
        var operations = [];
        var action_map = {
            'false,false': 'replace',
            'true,false': 'insert',
            'false,true': 'delete',
            'true,true': 'none'
        };
        var segment = createSegment(beforeTokens, afterTokens, 0, 0);
        var matches = findMatchingBlocks(segment);
        matches.push(new Match(beforeTokens.length, afterTokens.length, 0, segment));

        for (var index = 0; index < matches.length; index++){
            var match = matches[index];
            var matchStartsAtCurrentPositionInBefore = positionInBefore === match.startInBefore;
            var matchStartsAtCurrentPositionInAfter = positionInAfter === match.startInAfter;
            var actionUpToMatchPositions = action_map[[matchStartsAtCurrentPositionInBefore,
                    matchStartsAtCurrentPositionInAfter].toString()];
            if (actionUpToMatchPositions !== 'none'){
                operations.push({
                    action: actionUpToMatchPositions,
                    startInBefore: positionInBefore,
                    endInBefore: (actionUpToMatchPositions !== 'insert' ?
                            match.startInBefore - 1 : null),
                    startInAfter: positionInAfter,
                    endInAfter: (actionUpToMatchPositions !== 'delete' ?
                            match.startInAfter - 1 : null)
                });
            }
            if (match.length !== 0){
                operations.push({
                    action: 'equal',
                    startInBefore: match.startInBefore,
                    endInBefore: match.endInBefore,
                    startInAfter: match.startInAfter,
                    endInAfter: match.endInAfter
                });
            }
            positionInBefore = match.endInBefore + 1;
            positionInAfter = match.endInAfter + 1;
        }

        var postProcessed = [];
        var lastOp = {action: 'none'};

        function is_single_whitespace(op){
            if (op.action !== 'equal'){
                return false;
            }
            if (op.endInBefore - op.startInBefore !== 0){
                return false;
            }
            return /^\s$/.test(beforeTokens.slice(op.startInBefore, op.endInBefore + 1));
        }

        for (var i = 0; i < operations.length; i++){
            var op = operations[i];

            if ((is_single_whitespace(op) && lastOp.action === 'replace') ||
                    (op.action === 'replace' && lastOp.action === 'replace')){
                lastOp.endInBefore = op.endInBefore;
                lastOp.endInAfter = op.endInAfter;
            } else {
                postProcessed.push(op);
                lastOp = op;
            }
        }
        return postProcessed;
    }

    /**
     * Returns a list of tokens of a particular type starting at a given index.
     *
     * @param {number} start The index of first token to test.
     * @param {Array.<string>} content The list of tokens.
     * @param {function} predicate A function that returns true if a token is of
     *      a particular type, false otherwise. It should accept the following
     *      parameters:
     *      - {string} The token to test.
     */
    function consecutiveWhere(start, content, predicate){
        content = content.slice(start, content.length + 1);
        var lastMatchingIndex = null;

        for (var index = 0; index < content.length; index++){
            var token = content[index];
            var answer = predicate(token);

            if (answer === true){
                lastMatchingIndex = index;
            }
            if (answer === false){
                break;
            }
        }

        if (lastMatchingIndex !== null){
            return content.slice(0, lastMatchingIndex + 1);
        }
        return [];
    }

    /**
     * Wraps and concatenates a list of tokens with a tag. Does not wrap tag tokens,
     * unless they are wrappable (i.e. void and atomic tags).
     *
     * @param {sting} tag The tag name of the wrapper tags.
     * @param {Array.<string>} content The list of tokens to wrap.
     * @param {string} className (Optional) The class name to include in the wrapper tag.
     */
    function wrap(tag, content, className){
        var rendering = '';
        var position = 0;
        var length = content.length;

        while (true){
            if (position >= length) break;
            var non_tags = consecutiveWhere(position, content, isWrappable);
            position += non_tags.length;
            if (non_tags.length !== 0){
                var val = non_tags.join('');
                var attrs = className ? ' class="' + className + '"' : '';
                if (val.trim()){
                    rendering += '<' + tag + attrs + '>' + val + '</' + tag + '>';
                }
            }

            if (position >= length) break;

            var tags = consecutiveWhere(position, content, isTag);
            position += tags.length;
            rendering += tags.join('');
        }
        return rendering;
    }

    /**
     * OPS.equal/insert/delete/replace are functions that render an operation into
     * HTML content.
     *
     * @param {Object} op The operation that applies to a prticular list of tokens. Has the
     *      following keys:
     *      - {string} action One of {'replace', 'insert', 'delete', 'equal'}.
     *      - {number} startInBefore The beginning of the range in the list of before tokens.
     *      - {number} endInBefore The end of the range in the list of before tokens.
     *      - {number} startInAfter The beginning of the range in the list of after tokens.
     *      - {number} endInAfter The end of the range in the list of after tokens.
     * @param {Array.<string>} beforeTokens The before list of tokens.
     * @param {Array.<string>} afterTokens The after list of tokens.
     * @param {string} className (Optional) The class name to include in the wrapper tag.
     *
     * @return {string} The rendering of that operation.
     */
    var OPS = {
        'equal': function(op, beforeTokens, afterTokens, className){
            var tokens = afterTokens.slice(op.startInAfter, op.endInAfter + 1);
            return tokens.reduce(function(prev, curr){
                return prev + curr.string;
            }, '');
        },
        'insert': function(op, beforeTokens, afterTokens, className){
            var tokens = afterTokens.slice(op.startInAfter, op.endInAfter + 1);
            var val = tokens.map(function(token){
                return token.string;
            });
            return wrap('ins', val, className);
        },
        'delete': function(op, beforeTokens, afterTokens, className){
            var tokens = beforeTokens.slice(op.startInBefore, op.endInBefore + 1);
            var val = tokens.map(function(token){
                return token.string;
            });
            return wrap('del', val, className);
        },
        'replace': function(op, beforeTokens, afterTokens, className){
            return OPS['delete'].apply(null, arguments) + OPS['insert'].apply(null, arguments);
        }
    };

    /**
     * Renders a list of operations into HTML content. The result is the combined version
     * of the before and after tokens with the differences wrapped in tags.
     *
     * @param {Array.<string>} beforeTokens The before list of tokens.
     * @param {Array.<string>} afterTokens The after list of tokens.
     * @param {Array.<Object>} operations The list of operations to transform the before
     *      list of tokens into the after list of tokens, where each operation has the
     *      following keys:
     *      - {string} action One of {'replace', 'insert', 'delete', 'equal'}.
     *      - {number} startInBefore The beginning of the range in the list of before tokens.
     *      - {number} endInBefore The end of the range in the list of before tokens.
     *      - {number} startInAfter The beginning of the range in the list of after tokens.
     *      - {number} endInAfter The end of the range in the list of after tokens.
     * @param {string} className (Optional) The class name to include in the wrapper tag.
     *
     * @return {string} The rendering of the list of operations.
     */
    function renderOperations(beforeTokens, afterTokens, operations, className){
        return operations.reduce(function(rendering, op){
            return rendering + OPS[op.action](op, beforeTokens, afterTokens, className);
        }, '');
    }

    /*
    * Compares two pieces of HTML content and returns the combined content with differences
    * wrapped in <ins> and <del> tags.
    *
    * @param {string} before The HTML content before the changes.
    * @param {string} after The HTML content after the changes.
    * @param {string} className (Optional) The class attribute to include in <ins> and <del> tags.
    *
    * @return {string} The combined HTML content with differences wrapped in <ins> and <del> tags.
    */
    function diff(before, after, className){
        if (before === after) return before;

        before = htmlToTokens(before);
        after = htmlToTokens(after);
        var ops = calculateOperations(before, after);
        return renderOperations(before, after, ops, className);
    }

    diff.htmlToTokens = htmlToTokens;
    diff.findMatchingBlocks = findMatchingBlocks;
    findMatchingBlocks.findBestMatch = findBestMatch;
    findMatchingBlocks.createMap = createMap;
    findMatchingBlocks.createToken = createToken;
    findMatchingBlocks.createSegment = createSegment;
    findMatchingBlocks.getKeyForToken = getKeyForToken;
    diff.calculateOperations = calculateOperations;
    diff.renderOperations = renderOperations;

    if (typeof define === 'function'){
        define([], function(){
          return diff;
        });
    } else if (typeof module !== 'undefined' && module !== null){
        module.exports = diff;
    } else {
        this.htmldiff = diff;
    }
}).call(this);
