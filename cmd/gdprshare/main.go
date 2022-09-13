package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/misc"
	"github.com/lixmal/gdprshare/pkg/server"
)

const (
	Version = "0.4.3"
)

const (
	ConfigFile      = "config.yml"
	GracefulTimeout = 20 * time.Second
)

var flagCleanup *bool
var flagVersion *bool
var flagConfig *string

func init() {
	// cmdline arg "-version"
	flagVersion = flag.Bool("version", false, "print program version")
	// cmdline arg "-cleanup"
	flagCleanup = flag.Bool("cleanup", false, "start in cleanup mode: remove expired files/entries")
	// cmdline arg "-config"
	flagConfig = flag.String("config", ConfigFile, "configuration file path")
	flag.Parse()
}

func main() {
	if *flagVersion {
		version()
		os.Exit(0)
	}

	conf, err := config.New(*flagConfig)
	if err != nil {
		log.Fatalf("Failed to load config: %s", err)
	}

	db, err := database.New(conf)
	if err != nil {
		log.Fatalf("Creating database: %s", err)
	}

	if *flagCleanup {
		if errors := misc.Cleanup(db, conf); len(errors) > 0 {
			log.Println("File cleanup errors:")
			for _, err := range errors {
				log.Printf("%s\n", err)
			}
			os.Exit(len(errors))
		}
		os.Exit(0)
	}

	if _, err := os.Stat(conf.StorePath); os.IsNotExist(err) {
		// create files directory
		if err = os.Mkdir(conf.StorePath, 0700); err != nil {
			log.Fatalf("Failed to create file store path: %s\n", err)
		}
	}

	srv := server.New(db, conf)

	go func() {
		err := srv.Start()
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %s\n", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)
	<-sig

	log.Println("Server shutdown ...")

	ctx, cancel := context.WithTimeout(context.Background(), GracefulTimeout)
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalln(err)
	}
	cancel()
	log.Println("Finished")
}

func version() {
	fmt.Printf("%s version: %s\ngo version: %s %s/%s\n", os.Args[0], Version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}
