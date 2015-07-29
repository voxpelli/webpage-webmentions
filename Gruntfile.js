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
        'public/js/script.js',
        'test/**/*.js'
      ],
      options: { jshintrc: '.jshintrc' }
    },
    lintspaces: {
      files: ['<%= jshint.files %>'],
      options: { editorconfig: '.editorconfig' }
    },
    mocha_istanbul: {
      options: {
        root: './lib',
        mask: '**/*.spec.js'
      },
      unit: {
        src: 'test/unit'
      },
      basic: {
        src: 'test'
      },
      coveralls: {
        src: 'test',
        options: {
          coverage: true,
          reportFormats: ['lcovonly']
        }
      }
    },
    watch: {
      jshint : {
        files: ['<%= jshint.files %>'],
        tasks: ['test']
      }
    }
  });


  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-lintspaces');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-mocha-istanbul');

  grunt.registerTask('setTestEnv', 'Ensure that environment (database etc) is set up for testing', function () {
    process.env.NODE_ENV = 'test';
  });

  grunt.registerTask('travis',    ['lintspaces', 'jshint', 'setTestEnv', 'mocha_istanbul:coveralls']);
  grunt.registerTask('test',      ['lintspaces', 'jshint', 'setTestEnv', 'mocha_istanbul:basic']);
  grunt.registerTask('fast-test', ['lintspaces', 'jshint', 'setTestEnv', 'mocha_istanbul:unit']);
  grunt.registerTask('default', 'test');


  grunt.event.on('coverage', function(lcov, done){
    require('coveralls').handleInput(lcov, function(err){
      if (err) {
        return done(err);
      }
      done();
    });
  });
};
