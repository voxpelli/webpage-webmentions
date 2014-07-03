/*jslint node: true, white: true, indent: 2 */

"use strict";

module.exports = function (grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      files: [
        'Gruntfile.js',
        'lib/**/*.js',
        'migrations/**/*.js',
        'public/js/script.js'
      ],
      options: { jshintrc: '.jshintrc' }
    },
    lintspaces: {
      files: ['<%= jshint.files %>'],
      options: { editorconfig: '.editorconfig' }
    },
    watch: {
      jshint : {
        files: ['<%= jshint.files %>'],
        tasks: ['jshint']
      },
      lintspaces : {
        files: ['<%= lintspaces.files %>'],
        tasks: ['lintspaces']
      }
    }
  });

  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-lintspaces');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');

  grunt.registerTask('test', ['lintspaces', 'jshint']);
  grunt.registerTask('default', 'test');
};
