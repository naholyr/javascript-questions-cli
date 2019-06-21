#!/usr/bin/env node

const got = require('got')
const marked = require('marked')
const TerminalRenderer = require('marked-terminal')
const chalk = require('chalk')
const prompts = require('prompts')
const home = require('user-home')
const fs = require('fs').promises
const path = require('path')

const RESUME_FILE = path.join(home, '.javascript-questions-cli')

const prefixes = {
  en: '',
  ru: '_ru-RU',
  vi: '-vi',
  de: '-de_DE',
  // zh: '-zh_CN', // disabled due to parsing errors at this point
  bs: '-bs_BS'
}

const cleanup = s => s.trim().replace(/<i>(.*)<\/i>|<em>(.*)<\/em>/, '*$1*')

const getQuizz = async (lang = 'en') => {
  marked.setOptions({ renderer: new TerminalRenderer() })
  const prefix = prefixes[lang]
  if (prefix === undefined) {
    throw new Error(
      `Unsupported lang, supported: ${Object.keys(prefixes).join(', ')}`
    )
  }
  const url = `https://raw.githubusercontent.com/lydiahallie/javascript-questions/master/README${prefix ||
    ''}.md`
  const { body } = await got(url)
  return body
    .split(/---|\* \* \* \* \*/)
    .slice(1)
    .map(s => s && s.trim())
    .filter(s => !!s)
    .map(section => {
      try {
        const [, title, question, choices, answer, explanation] = section.match(
          /######\s*(.*?)\s*\n\s*(.*?)\s*((?:[-*]\s*[A-Z]: .*?)+)\s*<details>.*?#### .*?: ([A-Z])\n(.*?)<\/p>\s*<\/details>/ms
        )
        return {
          title: cleanup(title),
          question: cleanup(question),
          choices: choices.split('\n').map(s => {
            try {
              const [, choice, label] = s.match(/^[-*]\s*([A-Z]):\s*(.+?)\s*$/)
              return { choice, label: cleanup(label) }
            } catch (err) {
              console.log({ s })
              throw err
            }
          }),
          answer: cleanup(answer),
          explanation: cleanup(explanation)
        }
      } catch (err) {
        console.log({ section })
        throw err
      }
    })
}

const clearScreen = () => process.stdout.write('\033c\033[3J')

const showQuestion = async q => {
  clearScreen()
  process.stdout.write(chalk.bold.underline(q.title))
  process.stdout.write('\n\n')
  process.stdout.write(marked(q.question))
  process.stdout.write('\n')
  const { choice } = await prompts({
    name: 'choice',
    type: 'select',
    message: '',
    choices: q.choices.map(c => ({
      title: `${c.choice}. ${c.label}`,
      value: c.choice
    }))
  })
  process.stdout.write('\n')
  if (choice === undefined) {
    return null
  } else if (q.answer === choice) {
    process.stdout.write(chalk.green.bold('\tCORRECT!'))
  } else {
    process.stdout.write(chalk.red.bold('\tINCORRECT!'))
  }
  process.stdout.write('\n\n')
  process.stdout.write(marked(q.explanation))
  return choice
}

const save = async state => {
  const { value } = await prompts({
    type: 'confirm',
    name: 'value',
    message: 'Do you want to save your progress and resume later?',
    initial: true
  })
  if (value) {
    await fs.writeFile(RESUME_FILE, JSON.stringify(state))
    process.stdout.write(`Progress saved to ${chalk.bold(RESUME_FILE)}.`)
  } else {
    process.stdout.write(`Progress ${chalk.bold('NOT saved')}.`)
  }
}

const resume = async () => {
  try {
    const state = JSON.parse(await fs.readFile(RESUME_FILE))
    const { value } = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Found previous session, do you want to resume to question #${state.index +
        1}?`,
      initial: true
    })
    if (value) {
      return state
    }
  } catch (err) {
    // No file found, or invalid: restart
  }
  return { index: 0, history: [] }
}

const finished = async state => {
  process.stdout.write(chalk.bold('Your answers:\n'))
  state.history.forEach(({ choice, valid }) => {
    process.stdout.write(
      `- ${choice} (${
        valid ? chalk.green('correct') : chalk.red('incorrect')
      })\n`
    )
  })
  process.stdout.write('\n')
  const nbValid = state.history.reduce((n, { valid }) => (valid ? n + 1 : n), 0)
  const nbQuestions = state.history.length
  const percent = Math.round((nbValid * 100) / nbQuestions)
  const score = `${nbValid}/${nbQuestions} (${percent}%)`
  process.stdout.write(
    chalk.bold(
      `Your score: ${
        percent > 75
          ? chalk.green(score)
          : percent > 50
          ? score
          : chalk.red(score)
      }\n\n`
    )
  )
  try {
    await fs.unlink(RESUME_FILE)
    process.stdout.write(
      chalk.dim(
        `Note: history file ${chalk.bold(RESUME_FILE)} has been deleted.`
      )
    )
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Ignore: there was no history
    } else {
      process.stdout.write(
        chalk.red(
          `Note: failed to delete history file ${chalk.bold(RESUME_FILE)} (${
            err.message
          }).`
        )
      )
    }
  }
}

const main = async (lang = 'en') => {
  const quizz = await getQuizz(lang)
  const state = await resume()
  while (state.index < quizz.length) {
    const q = quizz[state.index]
    const choice = await showQuestion(q)
    if (choice === null) {
      break // Pressed Ctrl+C or Ctrl+D
    }
    state.history.push({ choice, valid: q.answer === choice })
    state.index++
    // There are more questions: ask to stop/continue
    if (state.index < quizz.length) {
      process.stdout.write('\n')
      const { next } = await prompts({
        type: 'confirm',
        name: 'next',
        message: 'Continue?',
        initial: true
      })
      if (!next) {
        break
      }
    }
  }
  if (state.index < quizz.length - 1) {
    await save(state)
  } else {
    await finished(state)
  }
}

main(process.argv[2]).catch(err => {
  console.error(err.message)
  process.exit(1)
})
